let playerCount = 0;
const INSTANCES = {};

const CONFIG = {
    autoFocus: false,
    type: Phaser.HEADLESS,
    parent: "phaser-example",
    width: 1280,
    height: 720,
    scene: {
        preload: preload,
        create: create,
        update: update
    },
    physics: {
        default: "arcade",
        arcade: {
            gravity: {
                y: 500
            }
        }
    }
};
const GAME = new Phaser.Game(CONFIG);

// Phaser 3.19.0 헤드리스 오류 수정
function WebGLTexture() {}

function preload() {
    // 리소스 불러오기
    this.load.image("bullet", "assets/sprites/bullet.png");
    this.load.image("player1", "assets/sprites/player1.png");
    this.load.image("player2", "assets/sprites/player2.png");
    this.load.image("player3", "assets/sprites/player3.png");

    this.load.image("tileset1", "assets/tilesets/four-seasons-tileset.png");
    this.load.image("tileset2", "assets/tilesets/[32x32] Rocky Grass.png");
    this.load.tilemapTiledJSON("map1", "assets/tilemaps/map1.json");
    this.load.tilemapTiledJSON("map2", "assets/tilemaps/map2.json");
}

function create() {
    this.players = this.physics.add.group();
    this.bullets = this.physics.add.group();

    // 게임 제한시간 타이머
    this.timer = "10:00";
    this.timerAlarm = this.time.addEvent({
        delay: 1000,
        callback: () => {
            let min = Number(this.timer.substr(0, 2));
            let sec = Number(this.timer.substr(3, 2));

            if (sec > 0) {
                sec--;
            } else {
                min--;
                sec = 59;
            }

            if (sec < 10) {
                sec = "0" + sec;
            }

            if (min < 10) {
                min = "0" + min;
            }
            this.timer = min + ":" + sec;
            io.emit("getTimer", this.timer);
        },
        loop: true
    });

    // 소켓 수신
    io.on("connection", (socket) => {
        // 접속중인 플레이어 수 보내기
        socket.emit("getPlayers", playerCount);

        // 새로운 플레이어 접속
        socket.on("ingame", (name, skin) => {
            console.log("a player connected");
            playerCount++;
            INSTANCES[socket.id] = {
                instanceId: socket.id,
                instanceType: "player",
                x: Math.floor(Math.random() * 1280),
                y: 100,
                name: name,
                sprite: skin,
                score: 0,
                hpMax: 100,
                hp: 100,
                deadAt: null,
                isMove: false,
                flipX: false
            };
            createPlayer(this, INSTANCES[socket.id]);
            socket.emit("currentInstances", INSTANCES);
            socket.broadcast.emit("addPlayer", INSTANCES[socket.id]);
            io.emit("getPlayers", playerCount);
        });

        // 플레이어 접속 끊김
        socket.on("disconnect", () => {
            this.players.getChildren().forEach((player) => {
                if (socket.id == player.instanceId) {
                    console.log("player disconnected");
                    playerCount--;
                    player.destroy();
                    delete INSTANCES[socket.id];
                    io.emit("disconnect", socket.id);
                    io.emit("getPlayers", playerCount);
                }
            });
        });

        // 플레이어 입력
        socket.on("playerInput", (inputData) => {
            this.players.getChildren().forEach((player) => {
                if (socket.id == player.instanceId) {
                    // 이동
                    if (inputData.left) {
                        player.body.setVelocityX(-200);
                        player.flipX = true;
                    } else if (inputData.right) {
                        player.body.setVelocityX(200);
                        player.flipX = false;
                    }

                    // 점프
                    if (inputData.up && player.body.onFloor()) {
                        player.body.setVelocityY(-400);
                    }

                    // 공격
                    if (inputData.attack && player.isAttack) {
                        const ID = uuidgen();
                        INSTANCES[ID] = {
                            instanceId: ID,
                            instanceType: "bullet",
                            x: player.x,
                            y: player.y,
                            sprite: "bullet",
                            attackAt: player.instanceId,
                            flipX: player.flipX
                        };
                        player.attackAlarm = this.time.addEvent({
                            delay: player.attackDelayTime,
                            callback: () => {
                                player.isAttack = true;
                            }
                        });
                        player.isAttack = false;
                        createBullet(this, INSTANCES[ID]);
                        io.emit("addBullet", INSTANCES[ID]);
                    }
                }
            });
        });

        // 핑 보내기
        socket.on("latency", () => {
            socket.emit("latency");
        });
    });

    // 맵 불러오기
    this.map = this.make.tilemap({ key: "map2" });
    this.tileset = this.map.addTilesetImage("[32x32] Rocky Grass", "tileset2");
    this.worldLayer = this.map.createStaticLayer("world", this.tileset, 0, 0);
    this.worldLayer.setCollisionByProperty({ solid: true });
    this.physics.world.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);

    // 충돌 | 파괴 처리
    this.physics.add.collider(this.players, this.worldLayer);
    this.physics.add.collider(this.players, this.bullets, (player, bullet) => {
        if (player.instanceId != bullet.attackAt) {
            if (player.hp > bullet.damage) {
                player.hp -= bullet.damage;
            } else {
                player.deadAt = bullet.attackAt;
                playerDead(this, player);
            }
            player.body.setVelocityX(bullet.knockbackPower * !bullet.flipX ? 500 : -500);
            player.body.setVelocityY(-bullet.knockbackPower * 200);
            destroyBullet(bullet);
        }
    });
    this.physics.add.collider(this.bullets, this.worldLayer, (bullet) => {
        destroyBullet(bullet);
    });
}

function update() {
    // 플레이어 업데이트
    this.players.getChildren().forEach((player) => {
        const PLAYER_INFO = INSTANCES[player.instanceId];
        PLAYER_INFO.x = player.x;
        PLAYER_INFO.y = player.y;
        PLAYER_INFO.hp = player.hp;
        PLAYER_INFO.isMove = Math.abs(player.body.velocity.x) > 20;
        PLAYER_INFO.flipX = player.flipX;

        if (!Phaser.Geom.Rectangle.Overlaps(this.physics.world.bounds, player.getBounds())) {
            playerDead(this, player);
        }
    });

    // 총알 업데이트
    this.bullets.getChildren().forEach((bullet) => {
        const BULLET_INFO = INSTANCES[bullet.instanceId];
        BULLET_INFO.x = bullet.x;
        BULLET_INFO.y = bullet.y;

        if (!Phaser.Geom.Rectangle.Overlaps(this.physics.world.bounds, bullet.getBounds())) {
            destroyBullet(bullet);
        }
    });

    // 모든 인스턴스 정보 보내기
    io.emit("instanceUpdates", INSTANCES);
}

function createPlayer(self, playerInfo) {
    const PLAYER = self.physics.add.sprite(playerInfo.x, playerInfo.y, playerInfo.sprite);
    self.players.add(PLAYER);
    PLAYER.body.setBounce(0, 0);
    PLAYER.body.setDragX(0.95);
    PLAYER.body.useDamping = true;

    PLAYER.instanceId = playerInfo.instanceId;
    PLAYER.hpMax = playerInfo.hpMax;
    PLAYER.hp = playerInfo.hp;
    PLAYER.isAttack = true;
    PLAYER.attackDelayTime = 100;
}

function createBullet(self, bulletInfo) {
    const BULLET = self.physics.add.sprite(bulletInfo.x, bulletInfo.y, bulletInfo.sprite);
    self.bullets.add(BULLET);
    BULLET.body.allowGravity = false;
    BULLET.body.velocity.x = !bulletInfo.flipX ? 500 : -500;

    BULLET.instanceId = bulletInfo.instanceId;
    BULLET.attackAt = bulletInfo.attackAt;
    BULLET.flipX = bulletInfo.flipX;
    BULLET.damage = 3;
    BULLET.knockbackPower = 1;
}

function destroyBullet(bullet) {
    bullet.destroy();
    delete INSTANCES[bullet.instanceId];
    io.emit("destroyBullet", bullet.instanceId);
}

function playerDead(self, player) {
    if (player.deadAt != null) {
        INSTANCES[player.deadAt].score++;
        player.attackAt = null;
    } else {
        // 자살
        INSTANCES[player.instanceId].score--;
    }
    player.x = Math.floor(Math.random() * 1280);
    player.y = 100;
    player.hp = player.hpMax;
}

// #region 유틸리티
function uuidgen() {
    function s4() {
        return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
    }
    return s4() + s4() + "-" + s4() + "-" + s4() + "-" + s4() + "-" + s4() + s4() + s4();
}
// #endregion

window.gameLoaded();
