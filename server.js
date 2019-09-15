/*
 * 게임 서버
 */
var express = require("express");
var app = express();
var server = require("http").createServer(app);
var io = require("socket.io")(server);

app.use("/Scenes", express.static(__dirname + "/Scenes"));
app.use("/Assets", express.static(__dirname + "/Assets"));
app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});

var port = 80;
server.listen(port, () => {
    console.log(`Listening on ${port}`);
});

var players = {};
var rooms = {};

io.on("connection", (socket) => {
    // 새로운 유저 연결됨
    players[socket.id] = {
        playerId: socket.id,
    };
    console.log("a user connected");

    // 접속중인 유저 연결 끊김
    socket.on("disconnect", () => {
        console.log("user disconnected");
        delete players[socket.id];
        io.emit("disconnect", socket.id);
    });

    socket.on("onlineUser", () => {
        socket.emit("onlineUser", Object.keys(players).length);
        socket.broadcast.emit("onlineUser", Object.keys(players).length);
    });
});

var tickRate = 1000 / 30;
setInterval(() => {
    // 서버 업데이트
    Object.keys(players).forEach((players) => {
        // players[player.playerId].x = player.x;
        // players[player.playerId].y = player.y;
    });
    io.emit("playerUpdates", players);
}, tickRate);