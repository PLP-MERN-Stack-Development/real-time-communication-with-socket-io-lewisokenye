import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Divider,
  IconButton,
  Badge,
  Drawer,
  AppBar,
  Toolbar,
  Fab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  InputAdornment,
  CircularProgress,
  Alert,
  Snackbar
} from '@mui/material';
import {
  Send,
  AttachFile,
  Search,
  EmojiEmotions,
  Notifications,
  NotificationsOff,
  ExitToApp,
  People,
  Chat as ChatIcon,
  VolumeUp,
  VolumeOff
} from '@mui/icons-material';
import { useSocket } from '../context/SocketContext.jsx';
import axios from 'axios';

function Chat({ user, onLogout }) {
  const { socket, isConnected } = useSocket();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [users, setUsers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [currentRoom, setCurrentRoom] = useState('global');
  const [rooms, setRooms] = useState(['global', 'general', 'random']);
  const [selectedUser, setSelectedUser] = useState(null);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [fileDialogOpen, setFileDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (socket && isConnected) {
      // Join global room
      socket.emit('join_room', currentRoom);

      // Load initial messages
      loadMessages();

      // Load users
      loadUsers();

      // Socket event listeners
      socket.on('receive_message', handleReceiveMessage);
      socket.on('user_online', handleUserOnline);
      socket.on('user_offline', handleUserOffline);
      socket.on('user_typing', handleUserTyping);
      socket.on('messages_history', handleMessagesHistory);
      socket.on('search_results', handleSearchResults);
      socket.on('notification', handleNotification);
      socket.on('reaction_added', handleReactionAdded);
      socket.on('message_read', handleMessageRead);

      return () => {
        socket.off('receive_message', handleReceiveMessage);
        socket.off('user_online', handleUserOnline);
        socket.off('user_offline', handleUserOffline);
        socket.off('user_typing', handleUserTyping);
        socket.off('messages_history', handleMessagesHistory);
        socket.off('search_results', handleSearchResults);
        socket.off('notification', handleNotification);
        socket.off('reaction_added', handleReactionAdded);
        socket.off('message_read', handleMessageRead);
      };
    }
  }, [socket, isConnected, currentRoom]);

  const loadMessages = () => {
    if (socket) {
      socket.emit('get_messages', { roomId: currentRoom, page: 1, limit: 50 });
    }
  };

  const loadUsers = async () => {
    try {
      const response = await axios.get('http://localhost:5000/users');
      setUsers(response.data);
      setOnlineUsers(new Set(response.data.filter(u => u.online).map(u => u.id)));
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const handleReceiveMessage = (message) => {
    setMessages(prev => {
      const existingIndex = prev.findIndex(m => m.id === message.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = message;
        return updated;
      } else {
        return [...prev, message];
      }
    });

    // Update unread count
    if (message.recipientId === user.id || (!message.recipientId && message.roomId === currentRoom)) {
      if (message.senderId !== user.id) {
        setUnreadCounts(prev => ({
          ...prev,
          [message.roomId || 'global']: (prev[message.roomId || 'global'] || 0) + 1
        }));

        // Play sound notification
        if (soundEnabled && message.senderId !== user.id) {
          playNotificationSound();
        }

        // Browser notification
        if (notificationsEnabled && message.senderId !== user.id) {
          showBrowserNotification(message);
        }
      }
    }
  };

  const handleUserOnline = (data) => {
    setOnlineUsers(prev => new Set([...prev, data.userId]));
    setSnackbar({ open: true, message: `${data.username} is online`, severity: 'info' });
  };

  const handleUserOffline = (data) => {
    setOnlineUsers(prev => {
      const newSet = new Set(prev);
      newSet.delete(data.userId);
      return newSet;
    });
    setSnackbar({ open: true, message: `${data.username} went offline`, severity: 'info' });
  };

  const handleUserTyping = (data) => {
    if (data.isTyping) {
      setTypingUsers(prev => new Set([...prev, data.userId]));
    } else {
      setTypingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(data.userId);
        return newSet;
      });
    }
  };

  const handleMessagesHistory = (data) => {
    setMessages(data.messages);
    setHasMore(data.hasMore);
    setPage(1);
  };

  const handleSearchResults = (results) => {
    setSearchResults(results);
  };

  const handleNotification = (notification) => {
    setSnackbar({ open: true, message: notification.message, severity: 'info' });
  };

  const handleReactionAdded = (data) => {
    setMessages(prev => prev.map(msg =>
      msg.id === data.messageId
        ? { ...msg, reactions: data.reaction }
        : msg
    ));
  };

  const handleMessageRead = (data) => {
    setMessages(prev => prev.map(msg =>
      msg.id === data.messageId
        ? { ...msg, readBy: [...(msg.readBy || []), data.userId] }
        : msg
    ));
  };

  const playNotificationSound = () => {
    const audio = new Audio('/notification.mp3');
    audio.play().catch(e => console.log('Audio play failed:', e));
  };

  const showBrowserNotification = (message) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`New message from ${message.senderUsername}`, {
        body: message.content,
        icon: '/favicon.ico'
      });
    }
  };

  const handleSendMessage = () => {
    if (!newMessage.trim() || !socket) return;

    const messageData = {
      message: newMessage,
      roomId: selectedUser ? null : currentRoom,
      recipientId: selectedUser ? selectedUser.id : null
    };

    socket.emit('send_message', messageData);
    setNewMessage('');

    // Stop typing
    socket.emit('typing_stop', { roomId: currentRoom });
  };

  const handleTyping = () => {
    if (!socket) return;

    socket.emit('typing_start', { roomId: currentRoom });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing_stop', { roomId: currentRoom });
    }, 1000);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    } else {
      handleTyping();
    }
  };

  const handleRoomChange = (roomId) => {
    setCurrentRoom(roomId);
    setSelectedUser(null);
    setUnreadCounts(prev => ({ ...prev, [roomId]: 0 }));
    if (socket) {
      socket.emit('join_room', roomId);
      socket.emit('get_messages', { roomId, page: 1, limit: 50 });
    }
  };

  const handleUserSelect = (user) => {
    setSelectedUser(user);
    setCurrentRoom(null);
    setUnreadCounts(prev => ({ ...prev, [`private_${user.id}`]: 0 }));
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      setFileDialogOpen(true);
    }
  };

  const handleFileSend = () => {
    if (!selectedFile || !socket) return;

    const reader = new FileReader();
    reader.onload = () => {
      const fileData = reader.result;
      socket.emit('send_file', {
        fileName: selectedFile.name,
        fileData,
        roomId: selectedUser ? null : currentRoom,
        recipientId: selectedUser ? selectedUser.id : null
      });
      setSelectedFile(null);
      setFileDialogOpen(false);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleSearch = () => {
    if (socket && searchQuery.trim()) {
      socket.emit('search_messages', searchQuery);
    }
  };

  const handleLoadMore = () => {
    if (socket && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      socket.emit('get_messages', { roomId: currentRoom, page: nextPage, limit: 50 });
    }
  };

  const requestNotificationPermission = () => {
    if ('Notification' in window) {
      Notification.requestPermission();
    }
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getChatTitle = () => {
    if (selectedUser) {
      return `Chat with ${selectedUser.username}`;
    }
    return currentRoom === 'global' ? 'Global Chat' : `#${currentRoom}`;
  };

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      {/* App Bar */}
      <AppBar position="fixed">
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setDrawerOpen(true)}
            sx={{ mr: 2 }}
          >
            <People />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            {getChatTitle()}
          </Typography>
          <IconButton color="inherit" onClick={() => setSoundEnabled(!soundEnabled)}>
            {soundEnabled ? <VolumeUp /> : <VolumeOff />}
          </IconButton>
          <IconButton color="inherit" onClick={() => setNotificationsEnabled(!notificationsEnabled)}>
            {notificationsEnabled ? <Notifications /> : <NotificationsOff />}
          </IconButton>
          <Button color="inherit" onClick={onLogout}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>

      {/* Sidebar */}
      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        <Box sx={{ width: 300, p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Rooms
          </Typography>
          <List>
            {rooms.map((room) => (
              <ListItem disablePadding key={room}>
                <ListItemButton
                  selected={currentRoom === room && !selectedUser}
                  onClick={() => handleRoomChange(room)}
                >
                  <ListItemAvatar>
                    <Avatar>
                      <ChatIcon />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText primary={`#${room}`} />
                  {unreadCounts[room] > 0 && (
                    <Badge badgeContent={unreadCounts[room]} color="primary" />
                  )}
                </ListItemButton>
              </ListItem>
            ))}
          </List>
          <Divider sx={{ my: 2 }} />
          <Typography variant="h6" gutterBottom>
            Online Users
          </Typography>
          <List>
            {users.filter(u => onlineUsers.has(u.id) && u.id !== user.id).map((u) => (
              <ListItem disablePadding key={u.id}>
                <ListItemButton
                  selected={selectedUser?.id === u.id}
                  onClick={() => handleUserSelect(u)}
                >
                  <ListItemAvatar>
                    <Avatar>{u.username[0].toUpperCase()}</Avatar>
                  </ListItemAvatar>
                  <ListItemText primary={u.username} />
                  <Chip label="Online" color="success" size="small" />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      </Drawer>

      {/* Main Chat Area */}
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', pt: 8 }}>
        {/* Messages */}
        <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2 }}>
          {hasMore && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <Button onClick={handleLoadMore} disabled={loading}>
                {loading ? <CircularProgress size={20} /> : 'Load More'}
              </Button>
            </Box>
          )}
          <List>
            {messages.map((message) => (
              <ListItem key={message.id} alignItems="flex-start">
                <ListItemAvatar>
                  <Avatar>{message.senderUsername[0].toUpperCase()}</Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="subtitle2" color="primary">
                        {message.senderUsername}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatTime(message.timestamp)}
                      </Typography>
                      {message.readBy && message.readBy.length > 1 && (
                        <Typography variant="caption" color="text.secondary">
                          ✓
                        </Typography>
                      )}
                    </Box>
                  }
                  secondary={
                    <Box>
                      <Typography variant="body1">{message.content}</Typography>
                      {message.reactions && message.reactions.length > 0 && (
                        <Box sx={{ mt: 1 }}>
                          {message.reactions.map((reaction, index) => (
                            <Chip
                              key={index}
                              label={reaction.emoji}
                              size="small"
                              sx={{ mr: 1 }}
                            />
                          ))}
                        </Box>
                      )}
                    </Box>
                  }
                />
              </ListItem>
            ))}
          </List>
          {typingUsers.size > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ pl: 9 }}>
              {Array.from(typingUsers).map(id => {
                const user = users.find(u => u.id === id);
                return user ? user.username : '';
              }).join(', ')} is typing...
            </Typography>
          )}
          <div ref={messagesEndRef} />
        </Box>

        {/* Message Input */}
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              fullWidth
              variant="outlined"
              placeholder="Type a message..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => fileInputRef.current.click()}>
                      <AttachFile />
                    </IconButton>
                    <input
                      type="file"
                      ref={fileInputRef}
                      style={{ display: 'none' }}
                      onChange={handleFileSelect}
                    />
                  </InputAdornment>
                ),
              }}
            />
            <Button
              variant="contained"
              endIcon={<Send />}
              onClick={handleSendMessage}
              disabled={!newMessage.trim()}
            >
              Send
            </Button>
          </Box>
        </Box>
      </Box>

      {/* File Upload Dialog */}
      <Dialog open={fileDialogOpen} onClose={() => setFileDialogOpen(false)}>
        <DialogTitle>Send File</DialogTitle>
        <DialogContent>
          <Typography>
            Send {selectedFile?.name}?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFileDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleFileSend} variant="contained">
            Send
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default Chat;
