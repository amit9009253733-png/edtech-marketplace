const express = require('express');
const { body, validationResult, query } = require('express-validator');
const locationService = require('../utils/locationService');
const User = require('../models/User');
const Tutor = require('../models/Tutor');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// @desc    Geocode address to coordinates
// @route   POST /api/location/geocode
// @access  Private
router.post('/geocode', authenticateToken, [
  body('address').notEmpty().withMessage('Address is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { address } = req.body;
    const result = await locationService.geocodeAddress(address);

    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }

  } catch (error) {
    console.error('Geocode error:', error);
    res.status(500).json({
      success: false,
      message: 'Geocoding failed'
    });
  }
});

// @desc    Reverse geocode coordinates to address
// @route   POST /api/location/reverse-geocode
// @access  Private
router.post('/reverse-geocode', authenticateToken, [
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { latitude, longitude } = req.body;
    const result = await locationService.reverseGeocode(latitude, longitude);

    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }

  } catch (error) {
    console.error('Reverse geocode error:', error);
    res.status(500).json({
      success: false,
      message: 'Reverse geocoding failed'
    });
  }
});

// @desc    Find tutors within radius
// @route   GET /api/location/tutors-nearby
// @access  Private
router.get('/tutors-nearby', authenticateToken, [
  query('latitude').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  query('longitude').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  query('radius').optional().isFloat({ min: 1, max: 50 }).withMessage('Radius must be between 1-50 km'),
  query('subject').optional().trim(),
  query('class').optional().trim(),
  query('board').optional().trim(),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1-50')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      latitude,
      longitude,
      radius = 5,
      subject,
      class: className,
      board,
      limit = 20
    } = req.query;

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const radiusInKm = parseFloat(radius);

    // Build aggregation pipeline
    const pipeline = [
      // Join with users collection
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      {
        $unwind: '$userInfo'
      },
      // Filter by location (within radius)
      {
        $match: {
          'userInfo.location': {
            $near: {
              $geometry: {
                type: 'Point',
                coordinates: [lng, lat]
              },
              $maxDistance: radiusInKm * 1000 // Convert to meters
            }
          },
          isAvailableForBooking: true,
          'kyc.verificationStatus': 'verified'
        }
      }
    ];

    // Add subject filter if provided
    if (subject) {
      pipeline.push({
        $match: {
          'subjects.name': new RegExp(subject, 'i')
        }
      });
    }

    // Add class filter if provided
    if (className) {
      pipeline.push({
        $match: {
          'subjects.classes': className
        }
      });
    }

    // Add board filter if provided
    if (board) {
      pipeline.push({
        $match: {
          'subjects.boards': board
        }
      });
    }

    // Calculate distance
    pipeline.push({
      $addFields: {
        distance: {
          $divide: [
            {
              $sqrt: {
                $add: [
                  {
                    $pow: [
                      {
                        $multiply: [
                          { $subtract: [{ $arrayElemAt: ['$userInfo.location.coordinates', 1] }, lat] },
                          111.32
                        ]
                      },
                      2
                    ]
                  },
                  {
                    $pow: [
                      {
                        $multiply: [
                          { $subtract: [{ $arrayElemAt: ['$userInfo.location.coordinates', 0] }, lng] },
                          { $multiply: [111.32, { $cos: { $multiply: [lat, Math.PI / 180] } }] }
                        ]
                      },
                      2
                    ]
                  }
                ]
              }
            },
            1
          ]
        }
      }
    });

    // Sort by distance and rating
    pipeline.push({
      $sort: {
        distance: 1,
        'rating.average': -1
      }
    });

    // Limit results
    pipeline.push({
      $limit: parseInt(limit)
    });

    // Project required fields
    pipeline.push({
      $project: {
        _id: 1,
        subjects: 1,
        rating: 1,
        bio: 1,
        experience: 1,
        teachingModes: 1,
        distance: 1,
        'userInfo._id': 1,
        'userInfo.firstName': 1,
        'userInfo.lastName': 1,
        'userInfo.avatar': 1,
        'userInfo.address': 1
      }
    });

    const tutors = await Tutor.aggregate(pipeline);

    // Calculate travel time for nearby tutors (optional)
    const tutorsWithTravelInfo = await Promise.all(
      tutors.map(async (tutor) => {
        try {
          const travelInfo = await locationService.getTravelInfo(
            `${lat},${lng}`,
            `${tutor.userInfo.address?.street || ''}, ${tutor.userInfo.address?.city || ''}`,
            'driving'
          );

          return {
            ...tutor,
            travelInfo: travelInfo.success ? travelInfo.data : null
          };
        } catch (error) {
          console.error('Travel info error for tutor:', tutor._id, error);
          return tutor;
        }
      })
    );

    res.json({
      success: true,
      data: {
        tutors: tutorsWithTravelInfo,
        searchLocation: {
          latitude: lat,
          longitude: lng,
          radius: radiusInKm
        },
        totalFound: tutors.length
      }
    });

  } catch (error) {
    console.error('Find nearby tutors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to find nearby tutors'
    });
  }
});

// @desc    Calculate distance between two points
// @route   POST /api/location/calculate-distance
// @access  Private
router.post('/calculate-distance', authenticateToken, [
  body('origins').isArray().withMessage('Origins must be an array'),
  body('destinations').isArray().withMessage('Destinations must be an array')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { origins, destinations } = req.body;
    const result = await locationService.calculateDistance(origins, destinations);

    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }

  } catch (error) {
    console.error('Calculate distance error:', error);
    res.status(500).json({
      success: false,
      message: 'Distance calculation failed'
    });
  }
});

// @desc    Find nearby places (schools, landmarks, etc.)
// @route   GET /api/location/nearby-places
// @access  Private
router.get('/nearby-places', authenticateToken, [
  query('latitude').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  query('longitude').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  query('radius').optional().isInt({ min: 100, max: 50000 }).withMessage('Radius must be between 100-50000 meters'),
  query('type').optional().isIn(['school', 'university', 'library', 'hospital', 'restaurant', 'gas_station']).withMessage('Invalid place type')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      latitude,
      longitude,
      radius = 5000,
      type = 'school'
    } = req.query;

    const result = await locationService.findNearbyPlaces(
      parseFloat(latitude),
      parseFloat(longitude),
      parseInt(radius),
      type
    );

    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }

  } catch (error) {
    console.error('Find nearby places error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to find nearby places'
    });
  }
});

// @desc    Get location from IP address
// @route   GET /api/location/from-ip
// @access  Private
router.get('/from-ip', authenticateToken, async (req, res) => {
  try {
    // Get client IP address
    const clientIP = req.headers['x-forwarded-for'] || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress ||
                     (req.connection.socket ? req.connection.socket.remoteAddress : null);

    // For development, use a default IP or skip IP geolocation
    if (clientIP === '::1' || clientIP === '127.0.0.1' || !clientIP) {
      return res.json({
        success: true,
        data: {
          latitude: 28.6139, // Default to Delhi, India
          longitude: 77.2090,
          city: 'New Delhi',
          region: 'Delhi',
          country: 'India',
          message: 'Using default location for localhost'
        }
      });
    }

    const result = await locationService.getLocationFromIP(clientIP);

    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }

  } catch (error) {
    console.error('Get location from IP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get location from IP'
    });
  }
});

// @desc    Get travel information between two points
// @route   POST /api/location/travel-info
// @access  Private
router.post('/travel-info', authenticateToken, [
  body('origin').notEmpty().withMessage('Origin is required'),
  body('destination').notEmpty().withMessage('Destination is required'),
  body('mode').optional().isIn(['driving', 'walking', 'bicycling', 'transit']).withMessage('Invalid travel mode')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { origin, destination, mode = 'driving' } = req.body;
    const result = await locationService.getTravelInfo(origin, destination, mode);

    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }

  } catch (error) {
    console.error('Get travel info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get travel information'
    });
  }
});

module.exports = router;
