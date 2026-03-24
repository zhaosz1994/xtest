// 在线用户管理模块
const onlineUsers = new Map();

module.exports = {
    addOnlineUser: function(socketId, user) {
        onlineUsers.set(socketId, user);
    },
    
    removeOnlineUser: function(socketId) {
        onlineUsers.delete(socketId);
    },
    
    getOnlineUser: function(socketId) {
        return onlineUsers.get(socketId);
    },
    
    getAllOnlineUsers: function() {
        return Array.from(onlineUsers.values());
    },
    
    isUserOnline: function(username) {
        for (const user of onlineUsers.values()) {
            if (user.username === username) {
                return true;
            }
        }
        return false;
    },
    
    getOnlineUsernames: function() {
        const usernames = new Set();
        for (const user of onlineUsers.values()) {
            usernames.add(user.username);
        }
        return Array.from(usernames);
    }
};
