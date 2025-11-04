const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// In-memory storage (in production, use a database)
let users = [];
let messages = [];
let onlineUsers = new Set();
let typingUsers = new Set();

// JWT Secret
const JWT_SECRET = 'your-secret-key';

// Middleware to verify JWT
const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User authentication
  socket.on('authenticate', (data) => {
    const { token } = data;
    const user = verifyToken(token);
    if (user) {
      socket.userId = user.id;
      socket.username = user.username;
      onlineUsers.add(user.id);
      io.emit('user_online', { userId: user.id, username: user.username });
      socket.emit('authenticated', { success: true });
    } else {
      socket.emit('authenticated', { success: false });
    }
  });

  // Join room
  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    socket.currentRoom = roomId;
    socket.emit('joined_room', roomId);
  });

  // Send message
  socket.on('send_message', (data) => {
    const { message, roomId, recipientId } = data;
    const newMessage = {
      id: uuidv4(),
      senderId: socket.userId,
      senderUsername: socket.username,
      content: message,
      timestamp: new Date(),
      roomId: roomId || 'global',
      recipientId,
      readBy: [socket.userId],
      reactions: []
    };

    messages.push(newMessage);

    if (recipientId) {
      // Private message
      io.to(recipientId).emit('receive_message', newMessage);
      socket.emit('receive_message', newMessage);
    } else {
      // Room message
      io.to(roomId || 'global').emit('receive_message', newMessage);
    }

    // Notification
    if (recipientId && recipientId !== socket.userId) {
      io.to(recipientId).emit('notification', {
        type: 'new_message',
        message: `New message from ${socket.username}`,
        messageId: newMessage.id
      });
    }
  });

  // Typing indicator
  socket.on('typing_start', (data) => {
    const { roomId } = data;
    typingUsers.add(socket.userId);
    socket.to(roomId || 'global').emit('user_typing', {
      userId: socket.userId,
      username: socket.username,
      isTyping: true
    });
  });

  socket.on('typing_stop', (data) => {
    const { roomId } = data;
    typingUsers.delete(socket.userId);
    socket.to(roomId || 'global').emit('user_typing', {
      userId: socket.userId,
      username: socket.username,
      isTyping: false
    });
  });

  // Mark message as read
  socket.on('mark_read', (messageId) => {
    const message = messages.find(m => m.id === messageId);
    if (message && !message.readBy.includes(socket.userId)) {
      message.readBy.push(socket.userId);
      io.emit('message_read', { messageId, userId: socket.userId });
    }
  });

  // Add reaction
  socket.on('add_reaction', (data) => {
    const { messageId, reaction } = data;
    const message = messages.find(m => m.id === messageId);
    if (message) {
      const existingReaction = message.reactions.find(r => r.userId === socket.userId);
      if (existingReaction) {
        existingReaction.emoji = reaction;
      } else {
        message.reactions.push({ userId: socket.userId, emoji: reaction });
      }
      io.to(message.roomId || 'global').emit('reaction_added', {
        messageId,
        reaction: { userId: socket.userId, emoji: reaction }
      });
    }
  });

  // File sharing
  socket.on('send_file', (data) => {
    const { fileName, fileData, roomId, recipientId } = data;
    const newMessage = {
      id: uuidv4(),
      senderId: socket.userId,
      senderUsername: socket.username,
      content: `Shared file: ${fileName}`,
      fileName,
      fileData,
      timestamp: new Date(),
      roomId: roomId || 'global',
      recipientId,
      type: 'file',
      readBy: [socket.userId],
      reactions: []
    };

    messages.push(newMessage);

    if (recipientId) {
      io.to(recipientId).emit('receive_message', newMessage);
      socket.emit('receive_message', newMessage);
    } else {
      io.to(roomId || 'global').emit('receive_message', newMessage);
    }
  });

  // Get messages
  socket.on('get_messages', (data) => {
    const { roomId, page = 1, limit = 50 } = data;
    const roomMessages = messages.filter(m => m.roomId === roomId || (!roomId && m.roomId === 'global'));
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedMessages = roomMessages.slice(-endIndex).reverse();
    socket.emit('messages_history', { messages: paginatedMessages, hasMore: roomMessages.length > endIndex });
  });

  // Search messages
  socket.on('search_messages', (query) => {
    const results = messages.filter(m =>
      m.content.toLowerCase().includes(query.toLowerCase()) &&
      (m.roomId === socket.currentRoom || m.recipientId === socket.userId || m.senderId === socket.userId)
    );
    socket.emit('search_results', results);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      io.emit('user_offline', { userId: socket.userId, username: socket.username });
    }
    typingUsers.delete(socket.userId);
  });
});

// API Routes
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    username,
    password: hashedPassword
  };
  users.push(user);
  res.json({ success: true });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (user && await bcrypt.compare(password, user.password)) {
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
    res.json({ success: true, token, user: { id: user.id, username: user.username } });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

app.get('/users', (req, res) => {
  const userList = users.map(u => ({ id: u.id, username: u.username, online: onlineUsers.has(u.id) }));
  res.json(userList);
});

const PORT = process.env.PORT || 6000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});