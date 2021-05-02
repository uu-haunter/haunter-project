import React from "react";
import { useState, useEffect, useReducer } from "react";
import {
  GoogleMap,
  useLoadScript,
  Marker,
  InfoWindow,
  Polyline,
} from "@react-google-maps/api";
import { computeDistanceBetween, interpolate } from "spherical-geometry-js";
import {
  routeRequest,
  geoPositionUpdateRequest,
  reserveSeatRequest,
  unreserveSeatRequest
} from "./messages.js";
import Fab from "@material-ui/core/Fab";
import Button from "@material-ui/core/Button";
import Brightness3Icon from "@material-ui/icons/Brightness3";
import MyLocationIcon from "@material-ui/icons/MyLocation";
import "./App.css";

// the maps default latitude, longitude and center
const defaultLat = 59.8585;
const defaultLng = 17.6389;
const defaultCenter = {
  lat: defaultLat,
  lng: defaultLng,
};

// the maps styling
const styles = require("./mapstyle.json");

// Styling for the maps container
const mapContainerStyle = {
  height: "100vh",
  width: "100vw",
};

// Styling for the polyline that is shown when drawing
// a route
const polyLineOptions = {
  strokeColor: "#FF0000",
  strokeOpacity: 0.8,
  strokeWeight: 2,
  fillColor: "#FF0000",
  fillOpacity: 0.35,
  clickable: false,
  draggable: false,
  editable: false,
  visible: true,
  radius: 30000,
  zIndex: 1,
};

function updateNavigatorGeolocation(callback) {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(callback);
  } else {
    alert("Browser error");
  }
}

// linear interpolation between two angles
function lerpDegrees(source, target, amount) {
  let angle = target - source;
  if(angle > 180) angle -= 360;
  else if(angle < -180) angle += 360;
  return source + angle * amount;
}

function vehicleDataReducer(state, action) {

  if(action.type === "setNewData") {
    let now = new Date().getTime();
    let serverUpdateInterval = now - state.timestamp;

    return {
      timestamp: now,
      serverUpdateInterval: serverUpdateInterval,
      vehicles: Object.fromEntries(
        action.payload.map((vehicle) => {
          let vehicleId = vehicle.descriptorId.toString();
          let entry = state.vehicles[vehicleId];

          return [
            vehicleId,
            {
              sourcePosition: entry
                ? { ...entry.targetPosition }
                : { ...vehicle.position },
              currentPosition: entry
                ? { ...entry.targetPosition }
                : { ...vehicle.position },
              targetPosition: { ...vehicle.position },
            },
          ];
        })
      )
    }
  }

  if(action.type === "animate") {
    // The time that has passed since the last realtime update was received.
    let dt = new Date().getTime() - state.timestamp;

    // Dividing the time delta with the time interval of realtime updates
    // in order to get the fraction of the way that the vehicle should have
    // reached if it moves at a constant rate of speed.
    let fraction = dt*1.0 / state.serverUpdateInterval;

    if(fraction > 1) return state;

    return {
      ...state,
      vehicles: Object.fromEntries(
        Object.entries(state.vehicles).map(([vehicleId, vehicle]) => {
          // interpolate between the source and target positions using the calculated fraction
          // to get the new position.
          let newLatLng = interpolate(
            vehicle.sourcePosition,
            vehicle.targetPosition,
            fraction
          );
          vehicle.currentPosition.latitude = newLatLng.lat();
          vehicle.currentPosition.longitude = newLatLng.lng();

          // interpolate between the source and target positions bearings using the calculated fraction
          // to get the new bearing.
          vehicle.currentPosition.bearing = lerpDegrees(
            vehicle.sourcePosition.bearing,
            vehicle.targetPosition.bearing,
            fraction
          );

          return [vehicleId, vehicle];
        })
      )
    };
  }

  throw new Error(`Unhandled action type: ${action.type}`);
}

/*
 * Function component for the Map of the application
 */
function Map(props) {
  // State-variables
  const [vehicleData, vehicleDataDispatch] = useReducer(
    vehicleDataReducer,
    {
      timestamp: 0,
      serverUpdateInterval: 1,
      vehicles: {}
    }
  );
  const [currentTheme, setCurrentTheme] = useState(styles.day);
  const [currentCenter, setCurrentCenter] = useState(defaultCenter);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [currentRoute, setRoute] = useState(null);
  const [activeReservation, setReservation] = useState(false);

  const { isLoaded, loadError } = useLoadScript({
    // Reads the google-maps api_key from your locally created .env file
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY,
  });

  const mapRef = React.useRef();
  const onMapLoad = React.useCallback((map) => {
    mapRef.current = map;
  }, []);

  // Default options of the GoogleMap component
  const options = {
    styles: currentTheme,
    disableDefaultUI: true,
    gestureHandling: "greedy"
  };

  useEffect(() => {
    const ms = 40; // milliseconds between position updates
    const updateInterval = setInterval(() => {
      vehicleDataDispatch({type: "animate"})
    }, ms);

    return () => {
      clearInterval(updateInterval);
    };
  }, [vehicleData, vehicleData.vehicles]);

  useEffect(() => {
    vehicleDataDispatch({
      type: "setNewData",
      payload: props.realtimeData
    });
  }, [props.realtimeData]);

  // Hook used to modify the route-data
  useEffect(() => {
    setRoute(props.route);
  }, [props.route]);

  // Update the position every second
  useEffect(() => {
    const interval = setInterval(() => {
      onBoundsChanged();
      //TODO: Maybe update userposition here
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // called when the maps bounds are changed e.g. when a user drags the map
  const onBoundsChanged = () => {
    let lat = mapRef.current.getCenter().lat();
    let lng = mapRef.current.getCenter().lng();
    let radius = getBoundingSphereRadius();

    props.wsSend(JSON.stringify(geoPositionUpdateRequest(radius, lat, lng)));
  };

  // returns the radius of the maps bounding sphere in meters
  const getBoundingSphereRadius = () => {
    let center = mapRef.current.getBounds().getCenter();
    let northEast = mapRef.current.getBounds().getNorthEast();

    // return the distance along the earths surface
    return computeDistanceBetween(center, northEast);
  };

  // Sets the center of the map to the user-position
  const setCoordinates = (position) => {
    setCurrentCenter({
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    });
  };

  // Changes between dark-theme and light-theme
  const changeTheme = () => {
    if (currentTheme === styles.day) {
      setCurrentTheme(styles.night);
    } else {
      setCurrentTheme(styles.day);
    }
  };

  if (loadError) return "Error";
  if (!isLoaded) return "Loading...";

  return (
    <div>
      <GoogleMap
        zoom={16}
        center={currentCenter}
        mapContainerStyle={mapContainerStyle}
        options={options}
        onClick={() => {
          setSelectedMarker(null);
          setRoute([]);
        }}
        onLoad={onMapLoad}
        onBoundsChanged={onBoundsChanged}
      >
        {Object.entries(vehicleData.vehicles).map(([vehicleId, vehicle]) => (
          <Marker
            key={vehicleId}
            position={{
              lat: vehicle.currentPosition.latitude,
              lng: vehicle.currentPosition.longitude,
            }}
            onClick={() => {
              setSelectedMarker(vehicleId);
              // TODO: Change argument for routeRequest when we have line data
              props.wsSend(JSON.stringify(routeRequest(vehicle.line)));
            }}
            icon={{
              path: "M25.5,8.25H23.22V3H4.82V8.25H2.5V9.53H4.82V51.34A1.67,1.67,0,0,0,6.48,53h15.1a1.65,1.65,0,0,0,1.64-1.65V9.53H25.5Z",
              scale: 0.5,
              anchor: new window.google.maps.Point(6, 25),
              rotation: vehicle.currentPosition.bearing,
              fillOpacity: 1,
              fillColor: "green"
            }}
          ></Marker>
        ))}
        {selectedMarker && (
          <InfoWindow
            position={{
              lat:
                vehicleData.vehicles[selectedMarker].currentPosition.latitude,
              lng:
                vehicleData.vehicles[selectedMarker].currentPosition.longitude,
            }}
            onCloseClick={() => {
              setSelectedMarker(null);
            }}
          >
            <div>
              <p>{`Bus ${vehicleData.vehicles[selectedMarker].line} \n Passengers ${vehicleData.vehicles[selectedMarker].passengers} / ${vehicleData.vehicles[selectedMarker].capacity}`}</p>
              {!activeReservation ? (
                <Button
                  variant="outlined"
                  color="primary"
                  onClick={() => {
                    setReservation(true);
                    props.wsSend(
                      JSON.stringify(reserveSeatRequest(selectedMarker))
                    );
                  }}
                >
                  Reserve Seat
                </Button>
              ) : (
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={() => {
                    setReservation(false);
                    props.wsSend(
                      JSON.stringify(unreserveSeatRequest())
                    );
                  }}
                >
                  cancel reservation
                </Button>
              )}
            </div>
          </InfoWindow>
        )}

        <Marker
          position={{
            lat: currentCenter.lat,
            lng: currentCenter.lng,
          }}
          onClick={() => {
            mapRef.current.setZoom(18);
            updateNavigatorGeolocation(setCoordinates);
          }}
          icon={{
            url: "/circle.svg",
            origin: new window.google.maps.Point(0, 0),
            anchor: new window.google.maps.Point(15, 15),
            //Change Size to (150,150) when using pulsating circle icon
            scaledSize: new window.google.maps.Size(150, 150),
          }}
        />

        {currentRoute && (
          <Polyline
            path={currentRoute.map((obj) => {
              return {
                // TODO: Message should send coords in number format instead of string
                lat: parseFloat(obj.lat),
                lng: parseFloat(obj.lng),
              };
            })}
            options={polyLineOptions}
          />
        )}
      </GoogleMap>
      <Fab
        id="locationButton"
        color="primary"
        aria-label="locationButton"
        onClick={() => {
          mapRef.current.setZoom(18);
          updateNavigatorGeolocation(setCoordinates);
        }}
      >
        <MyLocationIcon />
      </Fab>
      <Fab color="primary" id="themeButton" onClick={changeTheme}>
        <Brightness3Icon />
      </Fab>
    </div>
  );
}

export default Map;
