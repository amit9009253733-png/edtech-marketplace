const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Student = require('../models/Student');
const Tutor = require('../models/Tutor');
const User = require('../models/User');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// @desc    Get student profile
// @route   GET /api/students/profile
// @access  Private (Student)
router.get('/profile', authenticateToken, authorizeRoles('student'), async (req, res) => {
  try {
    const student = await Student.findOne({ user: req.user._id })
      .populate('user', 'firstName lastName email phone avatar address location')
      .populate('favoriteTutors', 'user subjects rating')
      .populate('favoriteTutors.user', 'firstName lastName avatar');

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found'
      });
    }

    res.json({
      success: true,
      data: { student }
    });

  } catch (error) {
    console.error('Get student profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch student profile'
    });
  }
});

// @desc    Create/Update student profile
// @route   POST /api/students/profile
// @access  Private (Student)
router.post('/profile', authenticateToken, authorizeRoles('student'), [
  body('currentClass').isIn(['LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']).withMessage('Invalid class'),
  body('board').isIn(['CBSE', 'ICSE', 'State Board', 'IB', 'IGCSE', 'NIOS']).withMessage('Invalid board'),
  body('school.name').notEmpty().withMessage('School name is required'),
  body('subjectsOfInterest').isArray().withMessage('Subjects of interest must be an array'),
  body('parentInfo.name').notEmpty().withMessage('Parent name is required'),
  body('parentInfo.relationship').isIn(['father', 'mother', 'guardian']).withMessage('Invalid relationship'),
  body('parentInfo.phone').matches(/^[6-9]\d{9}$/).withMessage('Please enter a valid parent phone number')
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
      currentClass,
      board,
      school,
      subjectsOfInterest,
      learningPreferences,
      parentInfo,
      goals,
      emergencyContact,
      specialRequirements
    } = req.body;

    let student = await Student.findOne({ user: req.user._id });

    if (!student) {
      student = new Student({ user: req.user._id });
    }

    // Update student profile
    student.currentClass = currentClass;
    student.board = board;
    student.school = school;
    student.subjectsOfInterest = subjectsOfInterest;
    student.learningPreferences = learningPreferences;
    student.parentInfo = parentInfo;
    student.goals = goals || [];
    student.emergencyContact = emergencyContact;
    student.specialRequirements = specialRequirements;

    await student.save();

    res.json({
      success: true,
      message: 'Student profile updated successfully',
      data: { student }
    });

  } catch (error) {
    console.error('Update student profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update student profile'
    });
  }
});

// @desc    Get student dashboard data
// @route   GET /api/students/dashboard
// @access  Private (Student)
router.get('/dashboard', authenticateToken, authorizeRoles('student'), async (req, res) => {
  try {
    const student = await Student.findOne({ user: req.user._id })
      .populate('user', 'firstName lastName email phone avatar');

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found'
      });
    }

    // Get upcoming sessions (you'll need to implement this with Booking model)
    // const upcomingSessions = await Booking.find({
    //   student: student._id,
    //   scheduledDate: { $gte: new Date() },
    //   status: { $in: ['scheduled', 'confirmed'] }
    // }).limit(5).populate('tutor');

    // Get recent progress
    const recentProgress = student.progress.slice(-5);

    // Get attendance summary
    student.updateAttendanceStats();

    const dashboardData = {
      profile: student,
      stats: student.stats,
      recentProgress,
      attendancePercentage: student.attendancePercentage,
      // upcomingSessions,
      profileCompletion: student.profileCompletionPercentage,
      overallProgress: student.calculateOverallProgress()
    };

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Get student dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data'
    });
  }
});

// @desc    Add tutor to favorites
// @route   POST /api/students/favorites/:tutorId
// @access  Private (Student)
router.post('/favorites/:tutorId', authenticateToken, authorizeRoles('student'), async (req, res) => {
  try {
    const { tutorId } = req.params;

    // Check if tutor exists
    const tutor = await Tutor.findById(tutorId);
    if (!tutor) {
      return res.status(404).json({
        success: false,
        message: 'Tutor not found'
      });
    }

    const student = await Student.findOne({ user: req.user._id });
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found'
      });
    }

    // Check if already in favorites
    if (student.favoriteTutors.includes(tutorId)) {
      return res.status(400).json({
        success: false,
        message: 'Tutor already in favorites'
      });
    }

    student.favoriteTutors.push(tutorId);
    await student.save();

    res.json({
      success: true,
      message: 'Tutor added to favorites'
    });

  } catch (error) {
    console.error('Add favorite tutor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add tutor to favorites'
    });
  }
});

// @desc    Remove tutor from favorites
// @route   DELETE /api/students/favorites/:tutorId
// @access  Private (Student)
router.delete('/favorites/:tutorId', authenticateToken, authorizeRoles('student'), async (req, res) => {
  try {
    const { tutorId } = req.params;

    const student = await Student.findOne({ user: req.user._id });
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found'
      });
    }

    student.favoriteTutors = student.favoriteTutors.filter(
      id => id.toString() !== tutorId
    );
    await student.save();

    res.json({
      success: true,
      message: 'Tutor removed from favorites'
    });

  } catch (error) {
    console.error('Remove favorite tutor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove tutor from favorites'
    });
  }
});

// @desc    Add progress entry
// @route   POST /api/students/progress
// @access  Private (Student, Tutor)
router.post('/progress', authenticateToken, authorizeRoles('student', 'tutor'), [
  body('studentId').optional().isMongoId().withMessage('Invalid student ID'),
  body('subject').notEmpty().withMessage('Subject is required'),
  body('assessment.score').isInt({ min: 0, max: 100 }).withMessage('Score must be between 0 and 100'),
  body('assessment.totalQuestions').isInt({ min: 1 }).withMessage('Total questions must be at least 1'),
  body('assessment.correctAnswers').isInt({ min: 0 }).withMessage('Correct answers must be at least 0')
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

    const { studentId, subject, assessment } = req.body;
    
    // Determine which student to update
    let targetStudentId;
    if (req.user.role === 'student') {
      targetStudentId = req.user._id;
    } else if (req.user.role === 'tutor' && studentId) {
      targetStudentId = studentId;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Student ID is required for tutors'
      });
    }

    const student = await Student.findOne({ user: targetStudentId });
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Add progress entry
    const tutorId = req.user.role === 'tutor' ? req.user._id : null;
    student.addProgress(subject, tutorId, assessment);
    await student.save();

    res.json({
      success: true,
      message: 'Progress added successfully',
      data: { progress: student.progress }
    });

  } catch (error) {
    console.error('Add progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add progress'
    });
  }
});

// @desc    Get student progress
// @route   GET /api/students/progress
// @access  Private (Student)
router.get('/progress', authenticateToken, authorizeRoles('student'), [
  query('subject').optional().trim(),
  query('tutor').optional().isMongoId().withMessage('Invalid tutor ID')
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

    const { subject, tutor } = req.query;

    const student = await Student.findOne({ user: req.user._id })
      .populate('progress.tutor', 'user')
      .populate('progress.tutor.user', 'firstName lastName avatar');

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found'
      });
    }

    let progress = student.progress;

    // Filter by subject
    if (subject) {
      progress = progress.filter(p => 
        p.subject.toLowerCase().includes(subject.toLowerCase())
      );
    }

    // Filter by tutor
    if (tutor) {
      progress = progress.filter(p => 
        p.tutor && p.tutor._id.toString() === tutor
      );
    }

    res.json({
      success: true,
      data: { 
        progress,
        overallProgress: student.calculateOverallProgress(),
        averageScore: student.stats.averageScore
      }
    });

  } catch (error) {
    console.error('Get progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch progress'
    });
  }
});

// @desc    Update notification preferences
// @route   PUT /api/students/notifications
// @access  Private (Student)
router.put('/notifications', authenticateToken, authorizeRoles('student'), async (req, res) => {
  try {
    const { notifications } = req.body;

    const student = await Student.findOneAndUpdate(
      { user: req.user._id },
      { notifications },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification preferences updated',
      data: { notifications: student.notifications }
    });

  } catch (error) {
    console.error('Update notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notification preferences'
    });
  }
});

// @desc    Get students by class and board (Admin/Employee)
// @route   GET /api/students/by-class-board
// @access  Private (Admin/Employee)
router.get('/by-class-board', authenticateToken, authorizeRoles('admin', 'employee'), [
  query('class').notEmpty().withMessage('Class is required'),
  query('board').notEmpty().withMessage('Board is required')
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

    const { class: currentClass, board } = req.query;

    const students = await Student.findByClassAndBoard(currentClass, board);

    res.json({
      success: true,
      data: { students }
    });

  } catch (error) {
    console.error('Get students by class and board error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students'
    });
  }
});

module.exports = router;
