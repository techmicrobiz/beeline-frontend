import _ from 'lodash';
import kickstartHelpTemplate from '../templates/kickstart-popup.html';
import loadingTemplate from '../templates/loading.html';


// Parse out the available regions from the routes
// Filter what is displayed by the region filter
// Split the routes into those the user has recently booked and the rest
export default function($scope, $state, UserService, RoutesService, $q,
  $ionicScrollDelegate, $ionicPopup, KickstarterService, $ionicLoading,
  SearchService, $timeout, loadingSpinner, uiGmapGoogleMapApi) {

  // https://github.com/angular/angular.js/wiki/Understanding-Scopes
  $scope.data = {
    error: null,
    kickstarter: null,
    backedKickstarter: null,
    filterText: '',
    stagingFilterText: '',
    nearbyKickstarterRoutes: null,
    placeQuery: null, // The place object used to search
    queryText: "", // The actual text in the box used only for the clear button
    getPlaceDetails: false,
    prediction: null,
    minNumRoutes: 3,
  };

 //FIXME: put place search into a directive
  uiGmapGoogleMapApi.then((googleMaps) => {
    // Initialize it with google autocompleteService and PlacesService
    let searchBox = document.getElementById('search-crowdstart');
    // Blur on enter
    searchBox.addEventListener("keypress", function(event) {
      if (event.key === "Enter") this.blur();
    });

    $scope.autocompleteService = new googleMaps.places.AutocompleteService();
    $scope.placesService = new google.maps.places.PlacesService(searchBox);
  });

  function autoComplete() {
    let searchBox = document.getElementById('search-crowdstart');
    if (!$scope.data.queryText || !$scope.autocompleteService) {
      $scope.data.isFiltering = false;
      return;
    };
    // show the spinner
    $scope.data.isFiltering = true;
    $scope.$digest();
    // default 'place' object only has 'queryText' but no geometry
    // if has predicted place assign the 1st prediction to place object
    let place = {queryText: $scope.data.queryText};
    const currentAutoComplete = $scope.autocompleteService.getPlacePredictions({
      componentRestrictions: {country: 'SG'},
      input: $scope.data.queryText
    }, (predictions) => {
      $scope.data.getPlaceDetails = false;
      $scope.data.prediction = predictions !== null && predictions.length > 0 ? predictions[0] : null;
      $scope.data.placeQuery =  place;
      $scope.data.isFiltering = false;
      $scope.$digest();
      return;
    })
  }

  $scope.$watch("data.queryText", (queryText) => {
    if (queryText.length === 0) $scope.data.placeQuery = null;
  });

  $scope.$watch('data.queryText',
    _.debounce(autoComplete, 1000, {leading: false, trailing: true})
  )

  $scope.refreshRoutes = function() {
    $q.all([KickstarterService.fetchCrowdstart(true),KickstarterService.fetchBids(true), KickstarterService.fetchNearbyKickstarterIds()])
    .then(()=>{
      $scope.data.error = null;
    })
    .catch(() => {
      $scope.data.error = true;
    })
    .then(() => {
      $scope.$broadcast('scroll.refreshComplete');
    })
  }

  var timeoutProise = function(promise, ms) {
    return Promise.race([promise, new Promise((resolve,reject)=>{
      $timeout(()=>reject(), ms);
    })])
  }

  //show loading spinner for the 1st time
  loadingSpinner(timeoutProise(KickstarterService.fetchCrowdstart(), 10*6000)
                  .then(()=>{
                    $scope.data.error = null;
                  })
                  .catch(()=>{
                    $scope.data.error = true;
                  })
                  .then(()=>{
                    if (!window.localStorage['showCrowdstart']) {
                      window.localStorage['showCrowdstart'] = true;
                      $scope.showHelpPopup();
                    }
                  }));

  $scope.$watchGroup([
    ()=>KickstarterService.getCrowdstart(),
    ()=>KickstarterService.getBids(),
    'data.placeQuery'
  ], ([crowdstartRoutes, userBids, placeQuery])=>{
      if (!crowdstartRoutes) return;

      $scope.userBids = userBids;
      $scope.recentBidsById = _.keyBy($scope.userBids, r=>r.routeId);
      let recentAndAvailable = _.partition(crowdstartRoutes, (x)=>{
        return _.includes(_.keys($scope.recentBidsById), x.id.toString());
      });
      // don't display it in backed list if the pass expires after 1 month of 1st trip
      //and don't display it if it's 7 days after expired and not actived
      let backedKickstarter = recentAndAvailable[0].filter((route)=>(!route.passExpired && route.isActived) || !route.isExpired || !route.is7DaysOld) || [];
      //don't display it in kickstarter if it's expired
      let kickstarter = recentAndAvailable[1].filter((route)=>!route.isExpired) || [];

      // Filter the routes
      if (placeQuery && placeQuery.geometry && placeQuery.queryText) {
        // $scope.data.filteredNearbyKickstarterRoutes = SearchService.filterRoutesByPlaceAndText($scope.data.filteredNearbyKickstarterRoutes,  placeQuery, placeQuery.queryText);
        kickstarter = SearchService.filterRoutesByPlaceAndText(kickstarter,  placeQuery, placeQuery.queryText);
        backedKickstarter = SearchService.filterRoutesByPlaceAndText(backedKickstarter,  placeQuery, placeQuery.queryText);

      } else if (placeQuery && placeQuery.queryText) {
        // $scope.data.filteredNearbyKickstarterRoutes = SearchService.filterRoutesByText($scope.data.filteredNearbyKickstarterRoutes,  placeQuery.queryText);
        kickstarter = SearchService.filterRoutesByText(kickstarter,  placeQuery.queryText);
        backedKickstarter = SearchService.filterRoutesByText(backedKickstarter,  placeQuery.queryText);
        if (kickstarter.length < $scope.data.minNumRoutes) {
          $scope.data.getPlaceDetails = true
        }
      }


      //publish
      $scope.data.filteredKickstarter = _.sortBy(kickstarter, (x)=> {return parseInt(x.label.slice(1))});
      $scope.data.filteredbackedKickstarter = _.sortBy(backedKickstarter, (x)=> {return parseInt(x.label.slice(1))});

  });

  $scope.$watch('data.getPlaceDetails', function (newVal, oldVal) {
    if (newVal && $scope.data.prediction !== null){
      $scope.placesService.getDetails({
        placeId: $scope.data.prediction.place_id
      }, result => {
        // If we fail getting the details then shortcircuit
        if (!result) {
          // $scope.data.placeQuery =  place;
          $scope.data.isFiltering = false;
          $scope.$digest();
          return;
        }
        // Otherwise return the fully formed place
        var place = {
          ...$scope.data.placeQuery,
          geometry: result.geometry
        }
        // Return the found place
        $scope.data.placeQuery =  place;
        $scope.data.isFiltering = false;
        $scope.$digest();
      });
    }
  });

  $scope.showHelpPopup = function(){
    $scope.kickstartHelpPopup = $ionicPopup.show({
      template: kickstartHelpTemplate,
      title: 'Crowdstart Routes',
      buttons: [
        {
          text: 'OK',
          type: 'button-positive',
          onTap: function(e) {
            $scope.closePopup();
          }
        }
      ]
    });
  }

  $scope.closePopup = function() {
    $scope.kickstartHelpPopup.close();
  }

}
