const axios = require('axios');

class LocationService {
  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
    this.baseUrl = 'https://maps.googleapis.com/maps/api';
  }

  // Geocode address to coordinates
  async geocodeAddress(address) {
    try {
      const response = await axios.get(`${this.baseUrl}/geocode/json`, {
        params: {
          address: address,
          key: this.apiKey
        }
      });

      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        return {
          success: true,
          data: {
            latitude: location.lat,
            longitude: location.lng,
            formattedAddress: response.data.results[0].formatted_address,
            addressComponents: response.data.results[0].address_components
          }
        };
      } else {
        return {
          success: false,
          message: 'Address not found'
        };
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      return {
        success: false,
        message: 'Geocoding service error'
      };
    }
  }

  // Reverse geocode coordinates to address
  async reverseGeocode(latitude, longitude) {
    try {
      const response = await axios.get(`${this.baseUrl}/geocode/json`, {
        params: {
          latlng: `${latitude},${longitude}`,
          key: this.apiKey
        }
      });

      if (response.data.status === 'OK' && response.data.results.length > 0) {
        return {
          success: true,
          data: {
            formattedAddress: response.data.results[0].formatted_address,
            addressComponents: response.data.results[0].address_components
          }
        };
      } else {
        return {
          success: false,
          message: 'Location not found'
        };
      }
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      return {
        success: false,
        message: 'Reverse geocoding service error'
      };
    }
  }

  // Calculate distance between two points using Distance Matrix API
  async calculateDistance(origins, destinations) {
    try {
      const response = await axios.get(`${this.baseUrl}/distancematrix/json`, {
        params: {
          origins: origins.join('|'),
          destinations: destinations.join('|'),
          units: 'metric',
          key: this.apiKey
        }
      });

      if (response.data.status === 'OK') {
        return {
          success: true,
          data: response.data
        };
      } else {
        return {
          success: false,
          message: 'Distance calculation failed'
        };
      }
    } catch (error) {
      console.error('Distance calculation error:', error);
      return {
        success: false,
        message: 'Distance service error'
      };
    }
  }

  // Find nearby places (for finding nearby landmarks, schools, etc.)
  async findNearbyPlaces(latitude, longitude, radius = 5000, type = 'school') {
    try {
      const response = await axios.get(`${this.baseUrl}/place/nearbysearch/json`, {
        params: {
          location: `${latitude},${longitude}`,
          radius: radius,
          type: type,
          key: this.apiKey
        }
      });

      if (response.data.status === 'OK') {
        return {
          success: true,
          data: response.data.results
        };
      } else {
        return {
          success: false,
          message: 'Nearby places search failed'
        };
      }
    } catch (error) {
      console.error('Nearby places search error:', error);
      return {
        success: false,
        message: 'Places search service error'
      };
    }
  }

  // Calculate distance between two coordinates using Haversine formula
  calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // Distance in kilometers
    return Math.round(distance * 100) / 100; // Round to 2 decimal places
  }

  // Convert degrees to radians
  toRadians(degrees) {
    return degrees * (Math.PI/180);
  }

  // Validate coordinates
  isValidCoordinates(latitude, longitude) {
    return (
      latitude >= -90 && latitude <= 90 &&
      longitude >= -180 && longitude <= 180
    );
  }

  // Get location from IP address (fallback method)
  async getLocationFromIP(ipAddress) {
    try {
      // Using a free IP geolocation service
      const response = await axios.get(`http://ip-api.com/json/${ipAddress}`);
      
      if (response.data.status === 'success') {
        return {
          success: true,
          data: {
            latitude: response.data.lat,
            longitude: response.data.lon,
            city: response.data.city,
            region: response.data.regionName,
            country: response.data.country,
            timezone: response.data.timezone
          }
        };
      } else {
        return {
          success: false,
          message: 'IP geolocation failed'
        };
      }
    } catch (error) {
      console.error('IP geolocation error:', error);
      return {
        success: false,
        message: 'IP geolocation service error'
      };
    }
  }

  // Format location for display
  formatLocationForDisplay(addressComponents) {
    let city = '';
    let state = '';
    let country = '';

    addressComponents.forEach(component => {
      if (component.types.includes('locality')) {
        city = component.long_name;
      } else if (component.types.includes('administrative_area_level_1')) {
        state = component.short_name;
      } else if (component.types.includes('country')) {
        country = component.short_name;
      }
    });

    return `${city}${state ? ', ' + state : ''}${country ? ', ' + country : ''}`;
  }

  // Get travel time and distance
  async getTravelInfo(origin, destination, mode = 'driving') {
    try {
      const response = await axios.get(`${this.baseUrl}/directions/json`, {
        params: {
          origin: origin,
          destination: destination,
          mode: mode,
          key: this.apiKey
        }
      });

      if (response.data.status === 'OK' && response.data.routes.length > 0) {
        const route = response.data.routes[0];
        const leg = route.legs[0];
        
        return {
          success: true,
          data: {
            distance: leg.distance,
            duration: leg.duration,
            steps: leg.steps,
            polyline: route.overview_polyline.points
          }
        };
      } else {
        return {
          success: false,
          message: 'Route not found'
        };
      }
    } catch (error) {
      console.error('Travel info error:', error);
      return {
        success: false,
        message: 'Travel info service error'
      };
    }
  }
}

module.exports = new LocationService();
