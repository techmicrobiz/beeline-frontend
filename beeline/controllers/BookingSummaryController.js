import assert from 'assert';

export default [
  '$scope',
  '$state',
  '$http',
  '$ionicPopup',
  'BookingService',
  'UserService',
  'StripeService',
  '$stateParams',
  'RoutesService',
  function ($scope, $state, $http, $ionicPopup,
    BookingService, UserService,
    StripeService, $stateParams, RoutesService) {

    $scope.book = {
      routeId: '',
      route: null,
      qty: 1,
      waitingForPaymentResult : false,
      promoCodes: undefined,
      selectedDates: [],
      boardStopId: undefined,
      alightStopId: undefined,
      boardStop: undefined,
      alightStop: undefined,
    };
    $scope.$on('$ionicView.beforeEnter', () => {
      $scope.book.routeId = $stateParams.routeId;
      $scope.book.selectedDates = $stateParams.selectedDates.map(function(item){
          return parseInt(item);
      });
      console.log($scope.book.selectedDates);
      $scope.book.boardStopId  = parseInt($stateParams.boardStop);
      $scope.book.alightStopId = parseInt($stateParams.alightStop);
      RoutesService.getRoute($scope.book.routeId)
      .then((route) => {
        $scope.book.route = route;
        $scope.book.boardStop = route.tripsByDate[$scope.book.selectedDates[0]]
              .tripStops
              .filter(ts => $scope.book.boardStop == ts.stop.id)[0];
        $scope.book.alightStop = route.tripsByDate[$scope.book.selectedDates[0]]
              .tripStops
              .filter(ts => $scope.book.alightStop == ts.stop.id)[0]
      });
    });

    // methods
    $scope.pay = async function() {
        try {
            // disable the button
            $scope.waitingForPaymentResult = true;

            if (window.CardIO) {
              var cardDetails = await new Promise((resolve, reject) => CardIO.scan({
                "expiry": true,
                "cvv": true,
                "zip": false,
                "suppressManual": false,
                "suppressConfirm": false,
                "hideLogo": true
              }, resolve, () => resolve(null)));

              if (cardDetails == null) return;

              var stripeToken = await new Promise((resolve, reject) => Stripe.createToken({
                  number:     cardDetails["card_number"],
                  cvc:        cardDetails["cvv"],
                  exp_month:  cardDetails["expiry_month"],
                  exp_year:   cardDetails["expiry_year"],
              }, (statusCode, response) => {
                  if (response.error)
                      reject(response.error.message);
                  else
                      resolve(response);
              }));
            }
            else if (StripeService.loaded) { // Use Stripe Checkout
              var stripeToken = await StripeService.promptForToken();
              if (stripeToken == null)
                return;
            }
            else { // Last resort :(
              throw new Error("There was some difficulty contacting the payment gateway." +
                " Please check your Internet connection");
            }

            if (!('id' in stripeToken)) {
                alert("There was an error contacting Stripe");
                return;
            }

            var result = await UserService.beeline({

                method: 'POST',
                url: '/transactions/payment_ticket_sale',
                data: {
                    stripeToken: stripeToken.id,
                    trips: BookingService.prepareTrips($scope.book),
                },
            });

            // This gives us the transaction items
            assert(result.status == 200);

            $state.go('tabs.booking-confirmation');
        } catch (err) {
          await $ionicPopup.alert({
            title: 'Error processing payment',
            template: err,
          })
        } finally {
          $scope.$apply(() => {
            $scope.waitingForPaymentResult = false;
          })
        }
    };

    $scope.addPromoCode = function() {
      var code = document.getElementById('promocode').value;

      console.log(code);

      if ((typeof(code) != 'undefined')&&(code.trim() != ''))
      {
        if (typeof($scope.book.promoCodes) == 'undefined')
          $scope.book.promoCodes = [];

        if ($scope.book.promoCodes.indexOf(code) != '-1') //dupe
          console.log('Duplicate code')
        else
        {
          $scope.book.promoCodes.push(code);
          code = '';
        }
      }
    }
  },
];