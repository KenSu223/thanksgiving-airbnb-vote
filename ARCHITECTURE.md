# 技术链条说明：感恩节 Airbnb 投票站

> 这是一个很薄的全栈：**浏览器 → Cloudflare 边缘节点 → Worker（后端）→ KV（数据库）**。
> 前端是 React 单页应用（Vite 构建到 `dist/`），由同一个 Worker 托管，部署在 Cloudflare Workers 免费计划上。

## 整体架构

- **运行平台**：Cloudflare Workers（无服务器，按请求执行，全球边缘节点就近响应）
- **数据库**：Cloudflare KV —— 每段行程一个 key，各存一份 JSON（房源数组），没有传统数据库：
  - `nov25`（11/25–26 · 9人 · 1晚）→ `state:nov25:v1`
  - `nov26`（11/26–29 · 14人 · 3晚）→ `state:v1`（沿用原来的 key，之前的房源和投票都在这里）
  - 全员共用、不分行程：`users:v1`（登录时选的名字，也是分账的成员名单）、`split:v1`（分账，全员一本账）。分账原来按行程存在上面两个 key 里，第一次读 `split:v1` 时自动合并过来（旧数据留在原处不删）
  - 餐厅：每段行程一份，`food:nov25:v1` / `food:nov26:v1`（`{ places: [...] }`，每家有名字、Google 地图链接、地址、坐标、Google 地点 id、备注、想去的人）
- **Secret Angel**：`angel:v1`（全员一份）。`prefs` 按名字（小写）存每人的礼物偏好（分类 id → `love` / `nope`，加一句备注）；`excluded` 是管理员排除的人；`draw` 是抽签结果（天使 → 要送礼的人）。管理员是名字为 Aster 的用户（`worker/angel/routes.js` 的 `ADMIN`）。抽签把所有参加的人随机排成一个圈，每人送给下一个（`worker/angel/draw.js`），所以不会抽到自己、也不会两人互送。接口只返回调用者自己的那一对。和投票一样，身份靠用户列表里的名字 + token，不是真正的密码登录
- **21 点**：不走 KV，是一个 Durable Object（`BlackjackTable`，SQLite 存储，免费计划只能用这种）。整张桌子的状态在它的内存里，玩家用 WebSocket（`/api/bj`）连上来，每次有变化就把整桌推给所有人。规则和流程在 `BlackjackGame` 里（6 副牌、庄家软 17 停、Blackjack 3:2、头两张可加倍、不分牌不保险；15 秒下注、30 秒一手）。筹码只在玩家站起来或断线时存进它自己的存储（`p:<名字>`），不按局存。坐下要用登录名单里的名字和 token。不在 21 点页面又没坐下的人会断开连接，10 分钟没下注会被站起来，免得白占免费的运行时长
- **斗地主**：和 21 点一样是 Durable Object（`DdzHall`，WebSocket `/api/ddz`），一个对象管 3 张桌（`ROOMS`），每桌 3 个座位，一个人同时只能坐一张桌。规则在 `worker/ddz/cards.js`（牌型识别、比大小：单、对、三带、顺子、连对、飞机带翅膀、四带二、炸弹、王炸），机器人在 `bot.js`（按牌力叫/抢地主，出牌先出小的、不拆王炸、不压队友、对手快走完了才炸），一桌的流程在 `game.js`（`DdzGame`：叫地主 → 抢地主（每抢一次 ×2，叫的人最后还能抢回来；三家都不叫就重新洗牌发牌，`redealtAt` 让页面提示「三家都不叫，重新洗牌发牌」）→ 地主拿 3 张底牌 → 出牌 → 结算。结果一直留在桌上，桌上的人点「再来一局」才发下一局，不会自己开）。空位开局时由机器人补上；叫地主 15 秒、出牌 30 秒。叫地主时超时算「不叫」（抢地主时算「不抢」），不会替没表态的人叫成地主；出牌超时由机器人代打一手；连续超时两次或掉线就托管（托管后叫地主也由机器人按牌力决定），局中站起来也是托管打完这局再走；局中来的人排队，下一局坐下。底分 10 豆，倍数 = 叫抢倍数 × 2^炸弹数（春天 / 反春再 ×2），地主一人对两家。豆子和 21 点筹码分开，存在 `DdzHall` 自己的存储里（`p:<名字>`，豆子、局数、胜局、补豆次数），同样只在站起来或断线时写；输光了下一局自动补到 1000。每个人只收到自己的牌，结算时才亮所有人的牌。没人连着时这局直接让机器人打完、记分，桌子空出来。「提示」（`hints.js`）：自己先出时给机器人的出法；要管别人的牌时列出手里所有管得上的出法（同牌型按拆不拆对子/三张/炸弹、再按大小排，后面是炸弹、王炸），每点一次换下一种，桌上的牌变了就从头来；都管不上才说「没有管得上的牌」。以前提示直接用机器人的出法，而机器人会故意不出（队友出的牌不压、早期不拆炸弹、不拿 2 压小单张），提示就会说管不上。轮到你的提醒在 `web/src/features/games/turnAlert.js`（斗地主、川麻在用；横幅样式是 `games/table.css` 的 `.gt-yourturn`）：按钮上方一条「🔔 轮到你了」，同时叮咚一声、手机震一下（iPhone 的网页不能震），页面在后台时标题闪；最后 5 秒变红、每秒滴一声，并写明超时会怎样；🔔/🔕 关声音（`localStorage` 的 `turnAlert`）。单元测试 `worker/ddz/ddz.test.js`（`node --test`）
- **三个牌桌游戏共用的大厅**：`worker/games/hall.js` 的 `TableHall` 管连线、选桌、用登录名单坐下（一个人在同一个游戏里只能坐一张桌）、豆子存取（`p:<名字>`）、大厅列表和豆子榜；`DdzHall` / `GuandanHall` / `MahjongHall` 只是继承它，写明用哪个游戏类、玩家能发哪些消息（`actions`：消息类型 → 调用桌子的方法，返回错误文字或 `{ reply }`）。三个游戏都有同样的托管、排队、站起来、再来一局、10 分钟不动自动站起
- **掼蛋**：Durable Object `GuandanHall`（WebSocket `/api/guandan`），3 张桌，每桌 4 人，对面是队友（座位 0+2 对 1+3）。规则在 `worker/guandan/cards.js`：两副牌 108 张，牌的 id 带第几副（`'10♥1'`、`'sj2'`）；级牌在单张/对子/三张/三带二/炸弹里比 A 大，在顺子/三连对/钢板/同花顺里按原位；红心级牌是「配」，能当任何非王的牌。牌型：单、对、三张、三带二、顺子（正好 5 张，A 可以当 1）、三连对、钢板、炸弹 4–10 张、同花顺（比 5 炸大、比 6 炸小）、天王炸。带配的牌可能有几种读法（`readPlays`），出牌时取最强的那种。机器人在 `bot.js`（拆牌：炸弹、钢板、三连对、顺子、三带二、对、单；先出小的组，跟牌用最便宜不拆炸的，队友的牌不压，对手快走完才炸；也给人「提示」）。一桌在 `game.js`（`GuandanGame`）：两队各自的级数从 2 打到 A，头游一方升级（队友二游 +3、三游 +2、末游 +1），在自己的 A 上赢且队友不是末游就整场赢、级数重来；从第二局起进贡（末游给头游最大的非配牌；双下两人都给，大的给头游）、还贡（10 以下）、两个大王抗贡；进贡的人先出。出完牌的人没人管，由队友接风。豆子每局 ±10×升的级数，整场赢 ±60
- **川麻**：Durable Object `MahjongHall`（WebSocket `/api/mahjong`），3 张桌，每桌 4 人，血战到底。牌在 `worker/mahjong/tiles.js`（108 张，`'m1'`..`'p9'`，同一种牌不分彼此）；`hand.js` 算能不能胡（四组一对或七对，手里不能有缺的那门）、番（平胡 0、对对胡 1、清一色 2、七对 2、带幺九 2、将对 +2、金钩钓 +1、每个根 +1、杠上花/杠上炮/抢杠/海底 +1、天胡 3、地胡 2，不封顶，取最大的拆法）、向听数（每门花色单独算、记住结果，再合起来，给机器人用）和听哪些牌（查叫用）。`bot.js`：换三张挑最没用的一门、定缺挑最少的一门、打牌先打缺的那门再挑向听最小、有效进张最多的，碰/杠只在不让牌变差时。一桌在 `game.js`（`MahjongGame`）：发牌（庄 14 张）→ 换三张（随机方向，大家一样）→ 定缺 → 打牌：缺的那门要先打完；别人打的牌可以胡（一炮多响）、杠、碰，没人要就下家摸；放过能胡的牌，到自己下次摸牌前都不能胡别人打的（过水不胡）；暗杠、补杠（别人可以抢杠）；胡了的人退出，剩下的接着打，三家胡完或摸完牌结束，摸完时查花猪（赔 16 底）、查大叫（没听牌的赔听牌的人最大番）。底分 5 豆 × 2^番，自摸每家多给一底；杠当场记账：直杠 2 底、暗杠每家 2 底、补杠每家 1 底。一炮多响时胡的那张只算一张（`won.shared`）。第一个胡的人下局坐庄（一炮多响就是点炮的人）
- **鲁班七号躲技能**（单人游戏）：整局游戏都在浏览器里跑（`web/src/features/dodge/sim.js`，每秒固定 60 帧的模拟；带种子的随机数、只用加减乘除和开方，同样的种子和输入总是一样的结果）。输入是 `[帧, 类型, a, b]`：0 = 右键走到 (x, y)（电脑），1 = 摇杆方向 0..63 / -1 停（手机），2 = 闪现方向。技能：钟馗钩子、安琪拉三个火球、王昭君冰（地上先出圈）、小乔扇子（会飞回来）、后羿大鸟、姜子牙激光（先出框），每个都先在地上提示再放；时间越长出得越密、一波越多、飞得越快、提示越短，后面几种过几十秒才加入。闪现 8 秒冷却。成绩由服务器核对（Durable Object `DodgeBoard`，`worker/dodge/board.js`）：开局 `POST /api/dodge/start` 拿一张票，票里有服务器发的种子、人、开局时间和模拟版本（`SIM_VERSION`），用只存在这个对象存储里的密钥签名（HMAC），所以服务器不用记住开过哪些局；页面记下这局的每个输入；死了以后 `POST /api/dodge/score` 交票和输入，服务器用同一份 `sim.js` 重放（`verify.js`），重放出来活了多久就是成绩（编出来的时间、改过的游戏都对不上），而且一局不能比开票到现在实际过去的时间还长（离线算好的完美输入不能马上交）。旧页面只交时间的会被要求刷新。每人只记最好的一次（`p:<名字>`，存在它自己的存储里，不走 KV），最好那局的种子和输入另存一份（`r:<名字>`）：排行榜上每条纪录旁边的 ▶ 就用它在本地重放（`GET /api/dodge/replay`，1× / 2× / 4×）；有票之前的老纪录没有输入，就没有 ▶。改了玩法（同样的种子和输入结果会变）要把 `SIM_VERSION` 加一，旧版本的票和回放就不再核对、播放。🤖：重放时 `verify.js` 还量反应——每次有新技能出现，就让一个「不再按任何键」的影子从英雄现在的状态往下走，会被打中就算一次危险；之后每一帧从真英雄的状态再试一次，第一次躲得开的那一帧就是这次的反应。人看到预警再改方向一般要 200 毫秒以上，程序下一帧就行。至少 15 次危险、中位数 ≤ 8 帧（133 毫秒）就标 🤖：只标不拦，按人的速度等一等再躲的外挂标不出来，那要靠看回放。用删掉的自动走位外挂校准过：它量出来 17 毫秒；同一个外挂故意慢到人的速度（200–300 毫秒），量出来 200 毫秒以上。它在两次请求之间什么都不用记（票里带着这局），所以一局打多久都能记上。网络不通时这局（票加输入）先存在这台设备上（`localStorage` 的 `dodgePending`，只留最好的一次），点「重新提交」或下次打开这页时再交。命中按整帧的移动轨迹算（`sweptHit`），快的技能不会从两帧之间穿过去；闪现会取消右键的目标点。`sim.test.js` 是模拟的单元测试（`node --test web/src/features/dodge/*.test.js`）。音效：`sound-events.js` 每一帧模拟之后看这一帧该响什么（技能出现在地上 = 预警音，持续到放出的那一刻；技能放出 = 释放音；小乔扇子折返、闪现、阵亡），按技能从哪边来做左右声道；不改模拟本身，用 node 测（`sound-events.test.js`）。`sfx.js` 用 Web Audio 现场合成这些声音（振荡器加滤波噪声，没有音频文件，也没拿游戏原版的音效），总线上有压缩器，后期技能一多也不会爆音；同一个声音 90 毫秒内只响一次、同时最多 12 个。浏览器只允许在点击/按键里开始放声音，所以「进入训练」、点技能卡、游戏里的任何点击都会调用 `unlock()`。🔊 按钮或 M 键静音，记在 `localStorage` 的 `dodgeSound`；开始页点技能卡试听。iPhone 开了静音键时网页音效也是静音的（系统行为）。前端：`DodgeGame`（画布、60 帧循环、右键/摇杆/闪现；手机上按住闪现键拖动瞄准，松手放，拖远了取消）、`viewport.js`（画面比碰撞区域大一圈，留给场景和鲁班的头）、`scenery.js`（峡谷背景）、`hero.js` / `hero-sprite.js`（八个方向的鲁班图集，没加载完先用画的）、`draw.js`（技能和预警）、`DodgeView`（开始页的技能卡、结算、排行榜）。图片在 `web/public/dodge/`：生成的鲁班图集和峡谷，都是 WebP（一共约 0.7 MB），不含官方的游戏图（见那里的 `SOURCES.md`）。手机开打就全屏并尝试锁横屏（安卓可以）；锁不了的（iPhone）竖着就提示横过来并暂停；切走、转回竖屏或点 ⏸ 都会暂停
- **域名**：`denver-thanksgiving-airbnb-vote.thanksgiving-vote.workers.dev`（免费子域名）

## 前端（`web/`，React + Vite + Tailwind）

按功能分目录，多人同时开发时尽量不碰同一个文件：

| 目录 | 内容 |
|---|---|
| `web/src/App.jsx` | 外框：开场动画、左侧导航/底部标签栏、标题、四个页面（切走只是藏起来，状态都还在） |
| `web/src/features/hunt/` | 选房：`HuntView`（数据和投票）、`ListingGrid`（卡片换位动画 FLIP + 投票后锚定位置）、`ListingCard`、`Carousel`（照片轮播）、`ListingMap`（Leaflet 地图）、`AddListingForm`、`price.js`（实时价/排序） |
| `web/src/features/food/` | 找餐厅：贴 Google 地图链接加店（`AddPlaceForm`）、店铺卡片（想去 / 在 Google 地图打开 / 导航）、`FoodMap`（Leaflet 钉子） |
| `web/src/features/split/` | 分账：成员、记一笔、余额和结清方案、支出记录（行内修改） |
| `web/src/features/games/` | Gameroom 页：`GamesView` 在 Blackjack、斗地主、掼蛋、川麻之间切（记在 `localStorage` 的 `game`）；几个游戏都一直挂着，只有看着的那个连服务器。旧链接 `#…/blackjack` 会跳到 `#…/games`。牌桌游戏共用的东西也在这：`useTable`（WebSocket、选桌、坐下/站起、提示）和 `useCountdown`；`PlayingCard`（扑克牌，掼蛋的配标「配」）；`CardHand`（手牌：点一张或按住划一串，pointer 事件，电脑和手机一样；手机竖着时牌更大，一行放不下就分几行叠着放，可以跨行划）；`TableFrame`（牌桌外框：手机横过来、坐在桌上时铺满整个屏幕，直接挂到 body 上，手牌和按钮不用滚动就在屏幕上，也离开屏幕底边的系统手势区）、`RoomPicker`、`PointsBoard`；`table.css`、`cards.css` |
| `web/src/features/blackjack/` | 21 点：`useBlackjack`（WebSocket 连线、坐下/站起）、牌桌各部分组件 |
| `web/src/features/ddz/` | 斗地主：`DdzView`（桌子、叫抢/出牌按钮、再来一局）、`SeatBox`；牌、手牌、外框用 `features/games` 的 |
| `web/src/features/guandan/` | 掼蛋：`GuandanView`（四个座位，对面是队友；级数、进贡/还贡、头游到末游、出的牌型标签）。出牌 60 秒（`GD.turnMs`）；轮到你出牌或还贡时按钮旁边一个会动的 🔔（`turnAlert.js`，叮咚、震动、后台标题闪，最后 5 秒变 ⏰、倒计时变红） |
| `web/src/features/mahjong/` | 川麻：`MahjongView`（三家的碰杠和弃牌、换三张/定缺/碰杠胡按钮、本局输赢）、`MjTile`（麻将牌，万是汉字，条和筒用 SVG 画；`inline` 是放在一行字里的牌）；手牌点一下选中、再点一下打出。电脑上排成一张桌子（对家在上、上家左、下家右，标着上家/对家/下家）；每家的碰杠和打出的牌分两行、各有小标签；换三张、定缺、有人打出你能碰杠胡的牌时，按钮上方一条横幅说做什么、剩几秒、超时会怎样（`turnAlert.js` 的提醒，最后 5 秒变红）；轮到你出牌只是按钮旁边一个会动的 🔔（出牌 60 秒，碰杠胡 10 秒，`MJ`）；能碰杠胡时按钮上带着那张牌、手里一样的牌抬起来；换三张拿到的三张标「新」、缺的那门标「缺」、手牌按门分开、刚摸的那张隔开一点、描一圈粗的橙边（别的地方不用橙色）；手机全屏时自己碰杠的、打过的牌在手牌正上方一行（中间那块会滚动，放里面看不见）；结算一人一行：谁、怎么样（第几胡·自摸/胡谁的·几番，点炮几次，听牌/没听/花猪）、输赢多少，赢的在上、你那行高亮；刚打出去的牌拍到桌上、扬起一点灰（`MjTile` 的 `slam`，换了 key 才会再播） |
| `web/src/features/dodge/` | 鲁班七号躲技能：`DodgeView`、`DodgeGame`、`draw.js`、`hero.js`、`scenery.js`、`viewport.js`、`sound-events.js`、`sfx.js`、`verify.js`（见上面）；模拟在同一目录的 `sim.js`（服务器也用它重放），测试 `sim.test.js`、`sound-events.test.js`、`verify.test.js` |
| `web/src/session/` | 登录：从用户列表选名字，名字和 token 存在 `localStorage`（`vn` / `vt`） |
| `web/src/components/` | 共用：开场动画、导航、标题、登录框、顶部横幅、照片轮播 `Carousel`（选房和餐厅卡片都用） |
| `web/src/lib/` | 共用：`api()`、行程和页面配置（`TRIPS`、`VIEWS`）、URL hash 路由（`#nov26/split`） |
| `web/public/` | 原样拷进 `dist/`：`manifest.webmanifest` 和图标（`icon-192/512.png`、`apple-touch-icon.png`），配合 `web/index.html` 里的苹果标签，网站能「添加到主屏幕」。从主屏幕打开没有浏览器地址栏——iPhone 上 Safari / Chrome 都不让网页自己隐藏地址栏（全屏接口只给视频），这是横屏玩游戏唯一的真全屏办法；躲技能在 iPhone 浏览器里会提示这一点 |

- 投票后先在原位更新，700ms 后再按新票数重排，卡片滑到新位置，投的那间在屏幕上不动
- 页面每次加载会补抓缺照片/评分/位置的房源，并让后端刷新过期的实时价

## 后端（`worker/`，跑在 Worker 里）

入口 `worker/index.js` 只做一件事：把各功能目录导出的路由表（`routes`）合并起来按「方法 + 路径」分发，其他路径交给 `env.ASSETS` 返回构建好的页面。功能目录：`listings/`（房源、抓取、实时价）、`food/`（餐厅：读 Google 地图链接）、`users/`（用户列表、登录）、`split/`（账本计算和存储）、`blackjack/`（规则 `game.js` 和 Durable Object `table.js`）、`games/`（三个牌桌游戏共用的 Durable Object 大厅 `hall.js`）、`ddz/`（斗地主：牌型 `cards.js`、机器人 `bot.js`、一桌 `game.js`、Durable Object `hall.js`）、`guandan/`、`mahjong/`（同样的分法；川麻的牌型在 `tiles.js` 和 `hand.js`）、`dodge/`（躲技能排行榜 Durable Object `board.js`）、`config/`（行程和预置房源）。每个接口都按 `trip`（GET 用 `?trip=`，POST 放在 body 里）选 KV key；不带 `trip` 的请求（比如还开着旧页面的人）默认走 `nov26`，也就是原来那份清单：

| 路由 | 作用 |
|---|---|
| `GET /api/state?trip=…` | 读该行程的 KV；没有就初始化（`nov26` 用 10 间预置房源 seed，`nov25` 从空清单开始） |
| `POST /api/add` | 正则从链接提 roomId（`/rooms/(\d+)`）→ 查重（重复返回 `deduped`）→ 调抓取 → 新房源 `unshift` 到数组头 → 写回 KV。地图链接（Google / Apple 地图）走酒店（`worker/listings/hotels.js`）：名字、地址、坐标、Google 地点 id 从链接读（`worker/lib/maplink.js`，见下面餐厅那行），区域按坐标自动分，照片用餐厅同一套（`food/photos.js`）；`kind: 'hotel'`，`roomId` 是 `map:<地点 id>`（没有 id 就用名字+坐标），同一家换个链接贴也只会有一张卡。价格 `rate: { nightly, source, dates?, at }` 是每间每晚：可以加的时候填（`nightly`），不填就读 Google 酒店搜索的页面（`/travel/search?q=<名字, 地址>`，桌面浏览器 UA）——服务器拿到的页面就停在这家酒店上，价格写在 `aria-label="$79 for dates Nov 24 – 25, <酒店名>"` 里（名字要对得上才算，防止拿到隔壁酒店的价）；日期是 Google 自己挑的（URL 里的日期它不理），所以存下日期、页面上写明是哪一晚的参考价。页面很大，边下边找，找到就断开。前端按每间住 4 人估间数，乘晚数得整趟估价，排序也用它。之前从 Booking.com 拉的酒店（`bk:…`，`priceUSD` 是整趟总价）照旧显示 |
| `POST /api/hotel-rate` | 酒店手填每间每晚的价格（`nightly`，空的就清掉），记下谁填的 |
| `POST /api/add-manual` | 手动表单，走同样入库 |
| `POST /api/vote` / `/api/remove` / `/api/enrich` | 投票、删除、补抓 |
| `GET /api/food?trip=…`、`POST /api/food/add` / `vote` / `remove` / `locate` | 餐厅（`worker/food/`）。只接受从 Google 地图复制的链接，读法在 `worker/lib/maplink.js`（酒店、活动也用它）：店名从 `/maps/place/<店名>/` 或带店铺 id 的 `?q=` 读，Maps app 分享出来的链接在店名后面接着街道地址（`<店名>, 1550 Court Pl, Denver, CO 80202`），从第一个「逗号+门牌号」处拆成店名和地址；坐标先用地点的钉子 `!3d<纬度>!4d<经度>`，再用 `@纬度,经度` 但只在放大到 15 级以上时（缩小的地图视野中心可能离店好几公里），都没有（app 分享的链接就只带地点 id）就用 OpenStreetMap 查地址的坐标，连地址也没有就按名字在这段行程的区域里查；有坐标没地址的反过来查出街道地址，卡片上显示。`maps.app.goo.gl` 短链接只跟着跳转展开（先用普通客户端，读不出来再用手机 UA）；Google 自己的地点页拿不到坐标（给服务器的页面是请求方所在地的地图）。读不出店名就回“找不到这家餐厅”。地址功能之前加的店（没有 `located`），页面打开时用现在的读法把链接重读一次（`POST /api/food/locate`）：名字里带着的地址拆掉、补上地址、坐标以钉子/地址为准，每家只做一次。加店时顺便取最多 10 张照片（`worker/food/photos.js`）：打开链接指向的店铺页，找到 Google 地图自己用的店铺详情请求（`/maps/preview/place?…`），只留类型是照片的（不要街景全景、视频和头像）；取不到就没有照片，店照样加上。之前加的店，页面打开时会补取一次（`POST /api/food/photos`） |
| 其他路径 | `env.ASSETS.fetch(request)` 返回构建好的页面（`dist/`） |

⚠️ 踩过的坑：`wrangler.toml` 的 `[assets]` 必须声明 `binding = "ASSETS"`，否则 `env.ASSETS` 是 `undefined`，首页报 Error 1101 而 `/api/*` 还正常。

## 抓取链条（`fetchListingInfo`，最折腾的部分）

Airbnb 会拦机房 IP（给 worker 返回机器人验证墙），所以做了三级 fallback，全程伪装 Chrome UA：

1. **直接抓用户给的 URL** → 解析：
   - `<title>` 取真实标题（去掉 " - Houses for Rent…" 后缀）
   - `og:image` 取图片
   - 正则抓卧室/床/浴室/可住人数
   - JSON-LD 里 `aggregateRating` 取评分和评价数（比 ★ 符号可靠）
2. **失败 → 抓 `airbnb.co.uk` 同房源页**：实测 `.com` 给机器人墙，`.co.uk` 直接给真页面
3. **再失败 → 走 r.jina.ai 阅读器代理**，转成 markdown 解析（`#` 标题、muscache 图片链接）
4. 都失败 → 返回 `ok: false`，前端弹手动表单

## 区域标签页（`worker/listings/zones.js`、`web/src/features/hunt/zones.js`）

每段行程在 `worker/config/trips.js` 里配几个区域（中心点 + 半径 km），名字和前端 `TRIPS.areas` 一致。房源有了位置但没区域时，后端按顺序分：落在配置的区域里（几个都包含就取最小的）→ 25 km 内最近的已分区房源的区域 → OpenStreetMap（Nominatim）反查城镇名，比如 Steamboat Springs，作为新区域。加房源、补抓到位置时当场分；页面加载时 `POST /api/zones` 把还没分的补上（每次最多 8 间，查城镇名间隔 1 秒，符合 Nominatim 的使用规则）。前端标签页 = 配置的区域（固定顺序）+ 房源里出现的其他区域（按数量排）+「未分区」。卡片左上角的区域标签可以点开改（`POST /api/area`），手动改过的（`areaManual`）不会再被自动分。

## 天气（`worker/weather/`、`web/src/features/weather/`）

选房页选中某个区域时（「全部」「未分区」不显示），地图正上方一行显示那里每天的天气 emoji 加最低/最高温。地点是这个区域房源位置的平均值，所以自动起的新区域也有天气。数据来自 Open-Meteo（免费、不用 key）：预报只有未来 16 天，更远的日子用过去 5 年同一天的实际天气代替（最常见的天气 + 平均温度，虚线框标「往年同期」），进了 16 天以内自动换成预报。后端 `GET /api/weather?trip=&lat=&lng=`（经纬度取整到 0.1°，约 10 km）把结果存在 KV（`weather:v1:<经纬度>:<日期>`）大家共用：往年数据永久缓存，预报最多 3 小时刷新一次，所以不管多少人打开页面，Open-Meteo 每天只会被调几次（直接从浏览器调会被限流，试过）。

## 日历（`web/src/features/calendar/`）

纯前端：读各页面已有的接口（每段行程的 `/api/state`、`/api/flights`），在 `agenda.js` 里变成一条条事件再按天（丹佛时间）分组。每种来源一个函数：`stayEvents`（每段行程票数最高的房源：入住 / 住在 / 退房，Airbnb 显示订不了会提醒）、`flightEvents`（某个人的到达和离开航班、谁来接 TA 或 TA 去接谁、全员还车）。可以切换看某个人或所有人。以后餐厅和活动的报名，加一个返回事件的函数、在 `CalendarView` 里合进去就行。

## 航班（`worker/flights/`、`web/src/features/flights/`）

每人填到达和离开航班：航班号、起飞日期、另一头的机场（到达默认飞到 DEN，离开默认从 DEN 走）、起飞和到达的当地时间。没有用付费航班 API，所以航线和时间要自己填（表单上有「查航班时间」链接）。机场列表在 `worker/flights/airports.js`（OpenFlights 数据，5500 个有 IATA 代码的机场，带经纬度和时区，ODbL 协议），`GET /api/airports?q=` 做自动补全。后端用 `Intl` 按两头机场的时区算出 UTC 时间和飞行时长（落地时间比起飞早就是第二天，红眼航班、跨太平洋都能算对），存在 KV `flights:v1`（按名字小写）。也可以帮朋友填，或者勾「不坐飞机」。

页面：航线地图（到达 / 离开分开看，大圆航线，同一航线的人合成一条线，人最多的机场标红；有动画：每条航线顺着飞行方向画出来——到达从外地飞进丹佛、离开从丹佛飞出去——然后白色虚线往前流、小飞机沿线飞，系统开了「减少动态效果」就不动）；接机提醒（落地后国内 +40 分钟、国际 +75 分钟到路边，同机场一小时内的合成一趟，可以认领「我来接」）；离开安排（全员一起去机场还租的车，所以整组一个时间：按最早起飞的那班，国内提前 2 小时、国际 3 小时到航站楼，再提前 30 分钟到租车点还车；每人显示到航站楼后要等多久）；「复制接送机安排」生成一段文字贴到群里。这些规则都在 `web/src/features/flights/plan.js`。

## 投票截止和最后决定（`worker/listings/decision.js`）

每段行程在 `worker/config/trips.js` 里有 `voteEndsAt`（太平洋时间 0 点，存成 UTC）。截止前选房页顶上有倒计时；截止后后端拒绝投票、加房源、删房源。选定的房子由后端算（`/api/state` 返回的 `vote`）：Airbnb 实时查询还能订的房源里票数最高的，平票选实时总价便宜的，再平就选先加的。管理员（Aster）截止后可以改选（`POST /api/decision`），也可以改回投票结果。订房：任何人可以「我来订」认领，负责的人或管理员标记「订好了」并填确认号和实付总价（`POST /api/booking`），存在行程的 KV 里。日历的住宿用的就是这个选定结果。卡片上的每人分摊 = 总价 ÷ 行程人数。

## 实时价格（`worker/listings/prices.js`）

Airbnb 房源页的价格框是浏览器单独请求的（GraphQL 持久化查询 `StaysPdpBookItQuery`，带公开的网页 API key）。Worker 用同样的请求，按每段行程的日期和人数查总价和是否可订；人数超过房源上限时按上限再查一次。结果存在房源的 `live` 字段，6 小时内不重复查。查询 hash 或 key 变了会查不到，卡片保留上次的价格并显示多久以前查的。

## 部署（`wrangler.toml`）

声明 worker 名、入口 `worker/index.js`、构建命令（`[build]`：`npm run build` 把前端构建到 `./dist`）、静态目录 `./dist`、KV 绑定（`VOTES_KV` → namespace id）、四个游戏的 Durable Object（`BlackjackTable`、`DdzHall`、`GuandanHall`、`MahjongHall`；migration v1、v2 各加一个，v3 加掼蛋和川麻两个）、躲技能排行榜 `DodgeBoard`（v5；v4 是 StoreDO）。推到 `main` 由 GitHub Action 自动 `npm ci` + `wrangler deploy`；每个 PR 都会跑 `npm run check`（lint + 构建 + 打包 worker）。KV namespace 用 `wrangler kv namespace create` 先建好再把 id 写进 toml。

**部署踩坑清单（2026-10-10）：**

1. 新账号必须先完成邮箱验证，否则非模态 "Verify your account" 弹窗会挡住 Worker 创建和 API token 创建（API 报 10034）。手机上可能看不到弹窗——以 API/机器的返回为准，不以手机 UI 为准
2. `wrangler login` 的 `localhost:8976` OAuth 回调到不了终端（浏览器不在同一台机器）→ 用手动 PKCE：自己生成 verifier/challenge/state → 用户在手机上（已登录 Cloudflare）打开 authorize URL → 把 localhost 回调 URL 粘贴回来 → `POST https://dash.cloudflare.com/oauth2/token` 换 token。注意：该 endpoint 对 Python-urllib UA 返回 403/error 1010，用 Chrome UA 就行
3. `[assets]` 必须声明 `binding = "ASSETS"`（见上方 Error 1101）
4. workers.dev 子域名要先注册：`PUT /accounts/{id}/workers/subdomain {"subdomain": name}`
5. 浏览器任务从 muse.ai 文件链接下载文件会被组织策略拦截——直接把代码粘贴进任务消息里更可靠
