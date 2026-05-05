// 在线用户管理模块
const onlineUsers = new Map();
const usernameIndex = new Map(); // username -> Set of socketIds

module.exports = {
    addOnlineUser: function(socketId, user) {
        onlineUsers.set(socketId, user);
        if (!usernameIndex.has(user.username)) {
            usernameIndex.set(user.username, new Set());
        }
        usernameIndex.get(user.username).add(socketId);
    },
    
    removeOnlineUser: function(socketId) {
        const user = onlineUsers.get(socketId);
        if (user) {
            const sockets = usernameIndex.get(user.username);
            if (sockets) {
                sockets.delete(socketId);
                if (sockets.size === 0) {
                    usernameIndex.delete(user.username);
                }
            }
        }
        onlineUsers.delete(socketId);
    },
    
    getOnlineUser: function(socketId) {
        return onlineUsers.get(socketId);
    },
    
    getAllOnlineUsers: function() {
        return Array.from(onlineUsers.values());
    },
    
    isUserOnline: function(username) {
        return usernameIndex.has(username);
    },
    
    getOnlineUsernames: function() {
        return Array.from(usernameIndex.keys());
    }
};
