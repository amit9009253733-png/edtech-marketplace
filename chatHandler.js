const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Store active connections
const activeConnections = new Map();

const chatHandler = (io) => {
  // Middleware to authenticate socket connections
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      if (user.status !== 'active') {
        return next(new Error('Authentication error: Account not active'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User ${socket.user.firstName} (${socket.user.role}) connected`);
    
    // Store user connection
    activeConnections.set(socket.user._id.toString(), {
      socketId: socket.id,
      user: socket.user,
      lastSeen: new Date()
    });

    // Join user to their personal room
    socket.join(`user_${socket.user._id}`);

    // Handle joining chat rooms
    socket.on('join_chat', async (data) => {
      try {
        const { chatId, participantId } = data;
        
        // Verify user is part of this chat
        const isAuthorized = await verifyChatAccess(socket.user._id, participantId, chatId);
        
        if (!isAuthorized) {
          socket.emit('error', { message: 'Unauthorized access to chat' });
          return;
        }

        socket.join(`chat_${chatId}`);
        socket.emit('joined_chat', { chatId });
        
        console.log(`User ${socket.user._id} joined chat ${chatId}`);
      } catch (error) {
        console.error('Join chat error:', error);
        socket.emit('error', { message: 'Failed to join chat' });
      }
    });

    // Handle sending messages
    socket.on('send_message', async (data) => {
      try {
        const { chatId, message, recipientId, messageType = 'text' } = data;
        
        // Verify user is part of this chat
        const isAuthorized = await verifyChatAccess(socket.user._id, recipientId, chatId);
        
        if (!isAuthorized) {
          socket.emit('error', { message: 'Unauthorized access to chat' });
          return;
        }

        // Create message object
        const messageData = {
          _id: generateMessageId(),
          chatId,
          sender: {
            _id: socket.user._id,
            firstName: socket.user.firstName,
            lastName: socket.user.lastName,
            role: socket.user.role,
            avatar: socket.user.avatar
          },
          recipient: recipientId,
          message: message,
          messageType: messageType,
          timestamp: new Date(),
          status: 'sent'
        };

        // Save message to database (you'll need to create a Message model)
        // const savedMessage = await Message.create(messageData);

        // Emit to chat room
        io.to(`chat_${chatId}`).emit('new_message', messageData);
        
        // Emit to recipient's personal room if they're online
        io.to(`user_${recipientId}`).emit('message_notification', {
          chatId,
          sender: messageData.sender,
          preview: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
          timestamp: messageData.timestamp
        });

        console.log(`Message sent from ${socket.user._id} to ${recipientId} in chat ${chatId}`);
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle typing indicators
    socket.on('typing_start', (data) => {
      const { chatId, recipientId } = data;
      socket.to(`chat_${chatId}`).emit('user_typing', {
        userId: socket.user._id,
        userName: socket.user.firstName,
        chatId
      });
    });

    socket.on('typing_stop', (data) => {
      const { chatId } = data;
      socket.to(`chat_${chatId}`).emit('user_stopped_typing', {
        userId: socket.user._id,
        chatId
      });
    });

    // Handle message status updates
    socket.on('message_read', async (data) => {
      try {
        const { messageId, chatId } = data;
        
        // Update message status in database
        // await Message.findByIdAndUpdate(messageId, { status: 'read', readAt: new Date() });
        
        // Notify sender
        socket.to(`chat_${chatId}`).emit('message_status_updated', {
          messageId,
          status: 'read',
          readBy: socket.user._id
        });
      } catch (error) {
        console.error('Message read error:', error);
      }
    });

    // Handle video call initiation
    socket.on('initiate_call', async (data) => {
      try {
        const { recipientId, callType = 'video' } = data;
        
        // Check if recipient is online
        const recipientConnection = activeConnections.get(recipientId);
        
        if (!recipientConnection) {
          socket.emit('call_failed', { message: 'Recipient is offline' });
          return;
        }

        const callData = {
          callId: generateCallId(),
          caller: {
            _id: socket.user._id,
            firstName: socket.user.firstName,
            lastName: socket.user.lastName,
            avatar: socket.user.avatar
          },
          callType,
          timestamp: new Date()
        };

        // Notify recipient
        io.to(`user_${recipientId}`).emit('incoming_call', callData);
        
        // Notify caller
        socket.emit('call_initiated', callData);
        
        console.log(`Call initiated from ${socket.user._id} to ${recipientId}`);
      } catch (error) {
        console.error('Call initiation error:', error);
        socket.emit('error', { message: 'Failed to initiate call' });
      }
    });

    // Handle call responses
    socket.on('call_response', (data) => {
      const { callId, recipientId, response, signalData } = data;
      
      io.to(`user_${recipientId}`).emit('call_response', {
        callId,
        response,
        signalData,
        from: socket.user._id
      });
    });

    // Handle WebRTC signaling
    socket.on('webrtc_signal', (data) => {
      const { recipientId, signalData } = data;
      io.to(`user_${recipientId}`).emit('webrtc_signal', {
        signalData,
        from: socket.user._id
      });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`User ${socket.user.firstName} disconnected`);
      
      // Update last seen and remove from active connections
      activeConnections.delete(socket.user._id.toString());
      
      // Notify other users in active chats
      socket.broadcast.emit('user_offline', {
        userId: socket.user._id,
        lastSeen: new Date()
      });
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  // Helper function to verify chat access
  const verifyChatAccess = async (userId, participantId, chatId) => {
    try {
      // In a real implementation, you'd check the database
      // For now, we'll do basic validation
      
      // Users can only chat with each other if they have a valid relationship
      // (e.g., student-tutor, student-admin, etc.)
      const user = await User.findById(userId);
      const participant = await User.findById(participantId);
      
      if (!user || !participant) {
        return false;
      }

      // Define allowed chat relationships
      const allowedCombinations = [
        ['student', 'tutor'],
        ['student', 'admin'],
        ['student', 'employee'],
        ['tutor', 'admin'],
        ['tutor', 'employee'],
        ['employee', 'admin']
      ];

      const userRoles = [user.role, participant.role].sort();
      const isAllowed = allowedCombinations.some(combo => 
        combo.sort().join(',') === userRoles.join(',')
      );

      return isAllowed;
    } catch (error) {
      console.error('Chat access verification error:', error);
      return false;
    }
  };

  // Helper function to generate message ID
  const generateMessageId = () => {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  };

  // Helper function to generate call ID
  const generateCallId = () => {
    return 'call_' + Date.now().toString() + Math.random().toString(36).substr(2, 9);
  };

  // Function to get online users
  const getOnlineUsers = () => {
    return Array.from(activeConnections.values()).map(conn => ({
      userId: conn.user._id,
      firstName: conn.user.firstName,
      lastName: conn.user.lastName,
      role: conn.user.role,
      lastSeen: conn.lastSeen
    }));
  };

  // Function to send notification to specific user
  const sendNotificationToUser = (userId, notification) => {
    io.to(`user_${userId}`).emit('notification', notification);
  };

  // Function to broadcast to all users of a specific role
  const broadcastToRole = (role, event, data) => {
    activeConnections.forEach((connection) => {
      if (connection.user.role === role) {
        io.to(connection.socketId).emit(event, data);
      }
    });
  };

  return {
    getOnlineUsers,
    sendNotificationToUser,
    broadcastToRole
  };
};

module.exports = chatHandler;
