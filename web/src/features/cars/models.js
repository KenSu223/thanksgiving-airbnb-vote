// 车型表：美国市场的车，按级别分组——租车常见的，也有跑车、皮卡这些不太会租的，挑得到就行。
// 服务器（worker/cars/routes.js）和页面共用这一份。
// 租车订的是「级别」（某某车或同级车型），到店才知道具体是哪辆，所以这里只要座位怎么排、
// 后备箱大概多大——不用接租车公司（他们也没有对个人开放的接口）。
//
// rows：每排几个座，第一排是主驾 + 副驾（面包车也是两个）。alt：同一款车常见的另一种排法
// （二排是长条座椅还是两个独立座椅，7 座 / 8 座），选车型时可以挑。
// liters：所有座位都用上时（三排车就是最后一排立着）后备箱实际能码行李的空间，大约是官方
// 容积（立方英尺，装到车顶）的七成（cuft × 28.3 × 0.68），用来和行李预设（bags.js）比。
export const CLASSES = [
  { id: 'sedan', name: '轿车', short: '轿车' },
  { id: 'hatch', name: '掀背 / 小车', short: '掀背' },
  { id: 'coupe', name: '跑车 / 双门 / 敞篷', short: '跑车' },
  { id: 'suv', name: '五座 SUV', short: '五座 SUV' },
  { id: 'suv3', name: '三排 SUV', short: '三排 SUV' },
  { id: 'mpv', name: '商务车（MPV）', short: 'MPV' },
  { id: 'truck', name: '皮卡（行李放车斗，露天）', short: '皮卡' },
  { id: 'bus', name: '大面包车（12–15 座）', short: '面包车' },
];

const L = cuft => Math.round(cuft * 28.317 * 0.68 / 10) * 10;
const BENCH8 = [2, 3, 3], CAPT7 = [2, 2, 3], SEVEN = [2, 3, 2], SIX = [2, 2, 2], FIVE = [2, 3], FOUR = [2, 2], TWO = [2];
// 一款车：id、级别、品牌、车型、排法（alt 另一种排法）、后备箱（立方英尺）。
// 后备箱是官方数据（所有座位都用上时；跑车是前后备箱加起来；皮卡是车斗，露天，bed: true，
// 电动皮卡把前备箱也算上），大约的数，只用来估行李。车型名都是美国市场的叫法。
const car = (id, cls, make, name, rows, cuft, extra) => ({ id, cls, make, name, rows, liters: L(cuft), ...extra });
const sedan = (id, make, name, cuft, rows = FIVE) => car(id, 'sedan', make, name, rows, cuft);
const hatch = (id, make, name, cuft, rows = FIVE) => car(id, 'hatch', make, name, rows, cuft);
const coupe = (id, make, name, cuft, rows = FOUR) => car(id, 'coupe', make, name, rows, cuft);
const suv = (id, make, name, cuft, rows = FIVE, alt) => car(id, 'suv', make, name, rows, cuft, alt ? { alt } : null);
const suv3 = (id, make, name, cuft, rows, alt) => car(id, 'suv3', make, name, rows, cuft, alt ? { alt } : null);
const mpv = (id, make, name, cuft, rows, alt) => car(id, 'mpv', make, name, rows, cuft, alt ? { alt } : null);
const truck = (id, make, name, cuft) => car(id, 'truck', make, name, FIVE, cuft, { bed: true });

export const MODELS = [
  // ---- 轿车 ----
  sedan('camry', 'Toyota', 'Camry', 15.1),
  sedan('corolla', 'Toyota', 'Corolla', 13.1),
  sedan('crown', 'Toyota', 'Crown', 15.2),
  sedan('mirai', 'Toyota', 'Mirai', 9.6),
  sedan('civic', 'Honda', 'Civic', 14.8),
  sedan('accord', 'Honda', 'Accord', 16.7),
  sedan('versa', 'Nissan', 'Versa', 15.0),
  sedan('sentra', 'Nissan', 'Sentra', 14.3),
  sedan('altima', 'Nissan', 'Altima', 15.4),
  sedan('maxima', 'Nissan', 'Maxima', 14.3),
  sedan('accent', 'Hyundai', 'Accent', 13.7),
  sedan('elantra', 'Hyundai', 'Elantra', 14.2),
  sedan('sonata', 'Hyundai', 'Sonata', 16.0),
  sedan('ioniq6', 'Hyundai', 'Ioniq 6', 11.2),
  sedan('rio', 'Kia', 'Rio', 13.7),
  sedan('forte', 'Kia', 'Forte', 15.3),
  sedan('k4', 'Kia', 'K4', 14.6),
  sedan('k5', 'Kia', 'K5', 16.0),
  sedan('stinger', 'Kia', 'Stinger', 23.3),
  sedan('mazda3sedan', 'Mazda', 'Mazda3 Sedan', 13.2),
  sedan('legacy', 'Subaru', 'Legacy', 15.1),
  sedan('wrx', 'Subaru', 'WRX', 12.5),
  sedan('malibu', 'Chevrolet', 'Malibu', 15.7),
  sedan('charger', 'Dodge', 'Charger', 16.5),
  sedan('c300', 'Chrysler', '300', 16.3),
  sedan('jetta', 'Volkswagen', 'Jetta', 14.1),
  sedan('passat', 'Volkswagen', 'Passat', 15.9),
  sedan('arteon', 'Volkswagen', 'Arteon', 27.2),
  sedan('mirageg4', 'Mitsubishi', 'Mirage G4', 12.3),
  sedan('model3', 'Tesla', 'Model 3', 19.8),
  sedan('models', 'Tesla', 'Model S', 25.0),
  sedan('bmw2gc', 'BMW', '2 Series Gran Coupe', 15.1),
  sedan('bmw3', 'BMW', '3 Series', 17.0),
  sedan('bmw5', 'BMW', '5 Series', 17.3),
  sedan('bmw7', 'BMW', '7 Series', 13.7),
  sedan('i4', 'BMW', 'i4', 16.6),
  sedan('i5', 'BMW', 'i5', 17.3),
  sedan('cla', 'Mercedes-Benz', 'CLA', 11.6),
  sedan('cclass', 'Mercedes-Benz', 'C-Class', 12.6),
  sedan('eclass', 'Mercedes-Benz', 'E-Class', 13.1),
  sedan('sclass', 'Mercedes-Benz', 'S-Class', 12.9),
  sedan('eqe', 'Mercedes-Benz', 'EQE', 15.1),
  sedan('eqs', 'Mercedes-Benz', 'EQS', 22.0),
  sedan('a3', 'Audi', 'A3', 10.9),
  sedan('a4', 'Audi', 'A4', 12.0),
  sedan('a5sb', 'Audi', 'A5 Sportback', 21.8),
  sedan('a6', 'Audi', 'A6', 13.7),
  sedan('a8', 'Audi', 'A8', 12.5),
  sedan('etrongt', 'Audi', 'e-tron GT', 14.3, FOUR),
  sedan('lexusis', 'Lexus', 'IS', 10.8),
  sedan('lexuses', 'Lexus', 'ES', 16.7),
  sedan('lexusls', 'Lexus', 'LS', 17.0),
  sedan('tlx', 'Acura', 'TLX', 13.5),
  sedan('q50', 'Infiniti', 'Q50', 13.5),
  sedan('g70', 'Genesis', 'G70', 10.5),
  sedan('g80', 'Genesis', 'G80', 13.1),
  sedan('g90', 'Genesis', 'G90', 12.7),
  sedan('ct4', 'Cadillac', 'CT4', 10.7),
  sedan('ct5', 'Cadillac', 'CT5', 11.9),
  sedan('s60', 'Volvo', 'S60', 11.6),
  sedan('s90', 'Volvo', 'S90', 13.5),
  sedan('polestar2', 'Polestar', 'Polestar 2', 14.3),
  sedan('lucidair', 'Lucid', 'Air', 22.1),
  sedan('giulia', 'Alfa Romeo', 'Giulia', 13.4),
  sedan('ghibli', 'Maserati', 'Ghibli', 17.7),
  sedan('panamera', 'Porsche', 'Panamera', 17.6, FOUR),
  sedan('taycan', 'Porsche', 'Taycan', 14.3, FOUR),

  // ---- 掀背 / 小车 ----
  hatch('corollahb', 'Toyota', 'Corolla Hatchback', 17.8),
  hatch('grcorolla', 'Toyota', 'GR Corolla', 17.8),
  hatch('prius', 'Toyota', 'Prius', 20.3),
  hatch('civichb', 'Honda', 'Civic Hatchback', 24.5),
  hatch('typer', 'Honda', 'Civic Type R', 24.5),
  hatch('fit', 'Honda', 'Fit', 16.6),
  hatch('integra', 'Acura', 'Integra', 24.3),
  hatch('mazda3hb', 'Mazda', 'Mazda3 Hatchback', 20.1),
  hatch('impreza', 'Subaru', 'Impreza', 20.4),
  hatch('golfgti', 'Volkswagen', 'Golf GTI', 19.9),
  hatch('golfr', 'Volkswagen', 'Golf R', 19.9),
  hatch('rio5', 'Kia', 'Rio 5-Door', 17.4),
  hatch('soul', 'Kia', 'Soul', 24.2),
  hatch('mirage', 'Mitsubishi', 'Mirage', 17.1),
  hatch('leaf', 'Nissan', 'Leaf', 23.6),
  hatch('bolt', 'Chevrolet', 'Bolt EV', 16.6),
  hatch('spark', 'Chevrolet', 'Spark', 11.1, FOUR),
  hatch('mini2', 'MINI', 'Cooper 2-Door', 8.7, FOUR),
  hatch('mini4', 'MINI', 'Cooper 4-Door', 13.1),
  hatch('fiat500e', 'Fiat', '500e', 7.5, FOUR),

  // ---- 跑车 / 双门 / 敞篷 ----
  coupe('corvette', 'Chevrolet', 'Corvette Stingray', 12.6, TWO),
  coupe('corvettecv', 'Chevrolet', 'Corvette Convertible', 12.6, TWO),
  coupe('z06', 'Chevrolet', 'Corvette Z06', 12.6, TWO),
  coupe('camaro', 'Chevrolet', 'Camaro', 9.1),
  coupe('camarocv', 'Chevrolet', 'Camaro Convertible', 7.3),
  coupe('mustang', 'Ford', 'Mustang', 13.5),
  coupe('mustangcv', 'Ford', 'Mustang Convertible', 11.4),
  coupe('challenger', 'Dodge', 'Challenger', 16.2, FIVE),
  coupe('miata', 'Mazda', 'MX-5 Miata', 4.6, TWO),
  coupe('miatarf', 'Mazda', 'MX-5 Miata RF', 4.5, TWO),
  coupe('gr86', 'Toyota', 'GR86', 6.3),
  coupe('supra', 'Toyota', 'GR Supra', 10.2, TWO),
  coupe('brz', 'Subaru', 'BRZ', 6.3),
  coupe('nissanz', 'Nissan', 'Z', 6.9, TWO),
  coupe('gtr', 'Nissan', 'GT-R', 8.8),
  coupe('bmw2', 'BMW', '2 Series Coupe', 10.0),
  coupe('m2', 'BMW', 'M2', 10.0),
  coupe('bmw4', 'BMW', '4 Series Coupe', 15.0),
  coupe('bmw4cv', 'BMW', '4 Series Convertible', 10.0),
  coupe('m4', 'BMW', 'M4', 15.0),
  coupe('bmw8', 'BMW', '8 Series Coupe', 14.8),
  coupe('z4', 'BMW', 'Z4', 9.9, TWO),
  coupe('ccoupe', 'Mercedes-Benz', 'C-Class Coupe', 10.5),
  coupe('sl', 'Mercedes-Benz', 'SL', 7.5),
  coupe('amggt', 'Mercedes-AMG', 'GT', 12.4, TWO),
  coupe('tt', 'Audi', 'TT', 12.0),
  coupe('r8', 'Audi', 'R8', 3.9, TWO),
  coupe('lexusrc', 'Lexus', 'RC', 10.4),
  coupe('lexuslc', 'Lexus', 'LC', 5.4),
  coupe('ftype', 'Jaguar', 'F-Type', 14.4, TWO),
  coupe('p911', 'Porsche', '911', 4.6),
  coupe('cayman', 'Porsche', '718 Cayman', 9.8, TWO),
  coupe('boxster', 'Porsche', '718 Boxster', 9.8, TWO),
  coupe('minicv', 'MINI', 'Cooper Convertible', 5.7),
  coupe('contgt', 'Bentley', 'Continental GT', 12.6),
  coupe('huracan', 'Lamborghini', 'Huracán', 3.5, TWO),
  coupe('f296', 'Ferrari', '296 GTB', 7.1, TWO),
  coupe('roma', 'Ferrari', 'Roma', 9.6),
  coupe('mclaren750', 'McLaren', '750S', 5.3, TWO),

  // ---- 五座 SUV ----
  suv('x5', 'BMW', 'X5', 33.9),
  suv('rav4', 'Toyota', 'RAV4', 37.6),
  suv('corollacross', 'Toyota', 'Corolla Cross', 25.5),
  suv('venza', 'Toyota', 'Venza', 28.8),
  suv('bz4x', 'Toyota', 'bZ4X', 27.7),
  suv('4runner', 'Toyota', '4Runner', 47.2),
  suv('landcruiser', 'Toyota', 'Land Cruiser', 37.5),
  suv('crv', 'Honda', 'CR-V', 39.3),
  suv('hrv', 'Honda', 'HR-V', 24.4),
  suv('passport', 'Honda', 'Passport', 41.2),
  suv('prologue', 'Honda', 'Prologue', 23.7),
  suv('rogue', 'Nissan', 'Rogue', 36.5),
  suv('kicks', 'Nissan', 'Kicks', 25.3),
  suv('murano', 'Nissan', 'Murano', 32.1),
  suv('ariya', 'Nissan', 'Ariya', 22.8),
  suv('equinox', 'Chevrolet', 'Equinox', 29.9),
  suv('equinoxev', 'Chevrolet', 'Equinox EV', 26.4),
  suv('trax', 'Chevrolet', 'Trax', 25.6),
  suv('trailblazer', 'Chevrolet', 'Trailblazer', 25.3),
  suv('blazer', 'Chevrolet', 'Blazer', 30.5),
  suv('blazerev', 'Chevrolet', 'Blazer EV', 25.5),
  suv('bolteuv', 'Chevrolet', 'Bolt EUV', 16.3),
  suv('escape', 'Ford', 'Escape', 37.5),
  suv('broncosport', 'Ford', 'Bronco Sport', 32.5),
  suv('bronco', 'Ford', 'Bronco 4-Door', 35.6),
  suv('bronco2', 'Ford', 'Bronco 2-Door', 22.4, FOUR),
  suv('edge', 'Ford', 'Edge', 39.2),
  suv('mache', 'Ford', 'Mustang Mach-E', 29.7),
  suv('tucson', 'Hyundai', 'Tucson', 38.7),
  suv('venue', 'Hyundai', 'Venue', 18.7),
  suv('kona', 'Hyundai', 'Kona', 25.5),
  suv('ioniq5', 'Hyundai', 'Ioniq 5', 27.2),
  suv('sportage', 'Kia', 'Sportage', 39.6),
  suv('seltos', 'Kia', 'Seltos', 26.6),
  suv('niro', 'Kia', 'Niro', 22.8),
  suv('ev6', 'Kia', 'EV6', 24.4),
  suv('grandcherokee', 'Jeep', 'Grand Cherokee', 37.7),
  suv('cherokee', 'Jeep', 'Cherokee', 25.8),
  suv('compass', 'Jeep', 'Compass', 27.2),
  suv('renegade', 'Jeep', 'Renegade', 18.5),
  suv('wrangler', 'Jeep', 'Wrangler Unlimited', 31.7),
  suv('wrangler2', 'Jeep', 'Wrangler 2-Door', 12.9, FOUR),
  suv('outback', 'Subaru', 'Outback', 32.5),
  suv('forester', 'Subaru', 'Forester', 28.7),
  suv('crosstrek', 'Subaru', 'Crosstrek', 19.9),
  suv('solterra', 'Subaru', 'Solterra', 27.7),
  suv('cx30', 'Mazda', 'CX-30', 20.2),
  suv('cx5', 'Mazda', 'CX-5', 30.8),
  suv('cx50', 'Mazda', 'CX-50', 31.4),
  suv('cx70', 'Mazda', 'CX-70', 39.6),
  suv('taos', 'Volkswagen', 'Taos', 27.9),
  suv('tiguan', 'Volkswagen', 'Tiguan', 37.6),
  suv('id4', 'Volkswagen', 'ID.4', 30.3),
  suv('atlascs', 'Volkswagen', 'Atlas Cross Sport', 40.3),
  suv('modely', 'Tesla', 'Model Y', 34.3),
  suv('terrain', 'GMC', 'Terrain', 29.6),
  suv('encoregx', 'Buick', 'Encore GX', 23.5),
  suv('envista', 'Buick', 'Envista', 20.7),
  suv('envision', 'Buick', 'Envision', 25.2),
  suv('outlandersport', 'Mitsubishi', 'Outlander Sport', 21.7),
  suv('eclipsecross', 'Mitsubishi', 'Eclipse Cross', 23.4),
  suv('countryman', 'MINI', 'Countryman', 25.0),
  suv('x1', 'BMW', 'X1', 25.7),
  suv('x2', 'BMW', 'X2', 25.3),
  suv('x3', 'BMW', 'X3', 31.5),
  suv('x4', 'BMW', 'X4', 18.5),
  suv('x6', 'BMW', 'X6', 27.4),
  suv('ix', 'BMW', 'iX', 35.5),
  suv('gla', 'Mercedes-Benz', 'GLA', 15.4),
  suv('glb', 'Mercedes-Benz', 'GLB', 22.0, FIVE, SEVEN),
  suv('glc', 'Mercedes-Benz', 'GLC', 21.9),
  suv('gle', 'Mercedes-Benz', 'GLE', 33.3),
  suv('gclass', 'Mercedes-Benz', 'G-Class', 38.1),
  suv('q3', 'Audi', 'Q3', 23.7),
  suv('q4etron', 'Audi', 'Q4 e-tron', 24.8),
  suv('q5', 'Audi', 'Q5', 25.8),
  suv('q8', 'Audi', 'Q8', 30.5),
  suv('q8etron', 'Audi', 'Q8 e-tron', 28.5),
  suv('lexusux', 'Lexus', 'UX', 17.1),
  suv('lexusnx', 'Lexus', 'NX', 22.7),
  suv('lexusrx', 'Lexus', 'RX', 29.6),
  suv('rdx', 'Acura', 'RDX', 29.5),
  suv('zdx', 'Acura', 'ZDX', 28.7),
  suv('qx50', 'Infiniti', 'QX50', 31.4),
  suv('qx55', 'Infiniti', 'QX55', 26.9),
  suv('gv60', 'Genesis', 'GV60', 24.0),
  suv('gv70', 'Genesis', 'GV70', 28.9),
  suv('gv80', 'Genesis', 'GV80', 34.9),
  suv('xt4', 'Cadillac', 'XT4', 22.5),
  suv('xt5', 'Cadillac', 'XT5', 30.0),
  suv('lyriq', 'Cadillac', 'Lyriq', 28.0),
  suv('corsair', 'Lincoln', 'Corsair', 27.6),
  suv('nautilus', 'Lincoln', 'Nautilus', 36.7),
  suv('xc40', 'Volvo', 'XC40', 20.7),
  suv('xc60', 'Volvo', 'XC60', 22.4),
  suv('macan', 'Porsche', 'Macan', 17.6),
  suv('cayenne', 'Porsche', 'Cayenne', 27.2),
  suv('evoque', 'Land Rover', 'Range Rover Evoque', 21.5),
  suv('velar', 'Land Rover', 'Range Rover Velar', 34.4),
  suv('rrsport', 'Land Rover', 'Range Rover Sport', 31.9),
  suv('rangerover', 'Land Rover', 'Range Rover', 34.6),
  suv('discosport', 'Land Rover', 'Discovery Sport', 24.8, FIVE, SEVEN),
  suv('defender90', 'Land Rover', 'Defender 90', 15.6),
  suv('defender110', 'Land Rover', 'Defender 110', 34.6, FIVE, SEVEN),
  suv('fpace', 'Jaguar', 'F-Pace', 25.5),
  suv('stelvio', 'Alfa Romeo', 'Stelvio', 18.5),
  suv('tonale', 'Alfa Romeo', 'Tonale', 22.9),
  suv('grecale', 'Maserati', 'Grecale', 20.2),
  suv('urus', 'Lamborghini', 'Urus', 21.8),
  suv('bentayga', 'Bentley', 'Bentayga', 17.1),
  suv('cullinan', 'Rolls-Royce', 'Cullinan', 21.2),

  // ---- 三排 SUV ----
  suv3('tahoe', 'Chevrolet', 'Tahoe', 25.5, BENCH8, CAPT7),
  suv3('suburban', 'Chevrolet', 'Suburban', 41.5, BENCH8, CAPT7),
  suv3('traverse', 'Chevrolet', 'Traverse', 23, BENCH8, CAPT7),
  suv3('yukon', 'GMC', 'Yukon', 25.5, BENCH8, CAPT7),
  suv3('yukonxl', 'GMC', 'Yukon XL', 41.5, BENCH8, CAPT7),
  suv3('acadia', 'GMC', 'Acadia', 22.9, BENCH8, CAPT7),
  suv3('enclave', 'Buick', 'Enclave', 23.0, CAPT7, BENCH8),
  suv3('escalade', 'Cadillac', 'Escalade', 25.5, CAPT7, BENCH8),
  suv3('escaladeesv', 'Cadillac', 'Escalade ESV', 41.5, CAPT7, BENCH8),
  suv3('xt6', 'Cadillac', 'XT6', 12.6, SIX, SEVEN),
  suv3('expedition', 'Ford', 'Expedition', 21, BENCH8, CAPT7),
  suv3('expeditionmax', 'Ford', 'Expedition MAX', 36, BENCH8, CAPT7),
  suv3('explorer', 'Ford', 'Explorer', 18.2, SEVEN, SIX),
  suv3('aviator', 'Lincoln', 'Aviator', 18.3, SIX, SEVEN),
  suv3('navigator', 'Lincoln', 'Navigator', 20.9, CAPT7, BENCH8),
  suv3('navigatorl', 'Lincoln', 'Navigator L', 34.3, CAPT7, BENCH8),
  suv3('highlander', 'Toyota', 'Highlander', 16, BENCH8, CAPT7),
  suv3('grandhighlander', 'Toyota', 'Grand Highlander', 20.6, BENCH8, CAPT7),
  suv3('sequoia', 'Toyota', 'Sequoia', 11.5, BENCH8, CAPT7),
  suv3('pilot', 'Honda', 'Pilot', 18.6, BENCH8, CAPT7),
  suv3('mdx', 'Acura', 'MDX', 18.1, SEVEN, SIX),
  suv3('telluride', 'Kia', 'Telluride', 21, BENCH8, CAPT7),
  suv3('sorento', 'Kia', 'Sorento', 12.6, SEVEN, SIX),
  suv3('ev9', 'Kia', 'EV9', 20.2, SEVEN, SIX),
  suv3('palisade', 'Hyundai', 'Palisade', 18, BENCH8, CAPT7),
  suv3('santafe', 'Hyundai', 'Santa Fe', 14.6, SEVEN, SIX),
  suv3('ioniq9', 'Hyundai', 'Ioniq 9', 21.9, SEVEN, SIX),
  suv3('pathfinder', 'Nissan', 'Pathfinder', 16.6, BENCH8, CAPT7),
  suv3('armada', 'Nissan', 'Armada', 16.5, BENCH8, CAPT7),
  suv3('qx60', 'Infiniti', 'QX60', 14.5, SEVEN, SIX),
  suv3('qx80', 'Infiniti', 'QX80', 22.0, BENCH8, CAPT7),
  suv3('atlas', 'Volkswagen', 'Atlas', 20.6, CAPT7, BENCH8),
  suv3('durango', 'Dodge', 'Durango', 17.2, CAPT7, BENCH8),
  suv3('grandcherokeel', 'Jeep', 'Grand Cherokee L', 17.2, SEVEN, SIX),
  suv3('wagoneer', 'Jeep', 'Wagoneer', 27.4, BENCH8, CAPT7),
  suv3('grandwagoneer', 'Jeep', 'Grand Wagoneer', 27.4, CAPT7, BENCH8),
  suv3('wagoneerl', 'Jeep', 'Wagoneer L', 44.2, BENCH8, CAPT7),
  suv3('cx90', 'Mazda', 'CX-90', 15.9, BENCH8, CAPT7),
  suv3('cx9', 'Mazda', 'CX-9', 14.4, SEVEN, SIX),
  suv3('ascent', 'Subaru', 'Ascent', 17.6, BENCH8, CAPT7),
  suv3('outlander', 'Mitsubishi', 'Outlander', 11.7, SEVEN),
  suv3('modelx', 'Tesla', 'Model X', 15.8, SIX, SEVEN),
  suv3('r1s', 'Rivian', 'R1S', 17.6, SEVEN),
  suv3('x7', 'BMW', 'X7', 12.8, SEVEN, SIX),
  suv3('gls', 'Mercedes-Benz', 'GLS', 17.4, SEVEN, SIX),
  suv3('q7', 'Audi', 'Q7', 14.2, SEVEN),
  suv3('lexustx', 'Lexus', 'TX', 20.1, SEVEN, SIX),
  suv3('lexusgx', 'Lexus', 'GX', 11.6, SEVEN, SIX),
  suv3('lexuslx', 'Lexus', 'LX', 11.4, SEVEN),
  suv3('xc90', 'Volvo', 'XC90', 15.8, SEVEN, SIX),
  suv3('discovery', 'Land Rover', 'Discovery', 9.1, SEVEN),
  suv3('defender130', 'Land Rover', 'Defender 130', 13.7, BENCH8),

  // ---- 商务车（MPV）----
  mpv('pacifica', 'Chrysler', 'Pacifica', 32.3, CAPT7, BENCH8),
  mpv('voyager', 'Chrysler', 'Voyager', 32.3, CAPT7, BENCH8),
  mpv('sienna', 'Toyota', 'Sienna', 33.5, CAPT7, BENCH8),
  mpv('odyssey', 'Honda', 'Odyssey', 32.8, BENCH8, CAPT7),
  mpv('carnival', 'Kia', 'Carnival', 40.2, BENCH8, CAPT7),
  mpv('idbuzz', 'Volkswagen', 'ID. Buzz', 18.6, SEVEN, SIX),

  // ---- 皮卡（四门，「后备箱」是车斗）----
  truck('f150', 'Ford', 'F-150', 52.8),
  truck('lightning', 'Ford', 'F-150 Lightning', 66.9),
  truck('ranger', 'Ford', 'Ranger', 43.3),
  truck('maverick', 'Ford', 'Maverick', 33.3),
  truck('silverado', 'Chevrolet', 'Silverado 1500', 62.9),
  truck('colorado', 'Chevrolet', 'Colorado', 41.9),
  truck('sierra', 'GMC', 'Sierra 1500', 62.9),
  truck('canyon', 'GMC', 'Canyon', 41.9),
  truck('ram1500', 'Ram', '1500', 53.9),
  truck('tundra', 'Toyota', 'Tundra', 54.0),
  truck('tacoma', 'Toyota', 'Tacoma', 38.0),
  truck('frontier', 'Nissan', 'Frontier', 33.5),
  truck('titan', 'Nissan', 'Titan', 57.0),
  truck('ridgeline', 'Honda', 'Ridgeline', 41.2),
  truck('santacruz', 'Hyundai', 'Santa Cruz', 27.0),
  truck('gladiator', 'Jeep', 'Gladiator', 35.0),
  truck('cybertruck', 'Tesla', 'Cybertruck', 67.0),
  truck('r1t', 'Rivian', 'R1T', 52.0),

  // ---- 大面包车（后备箱是最后一排后面实际能放的，升）----
  { id: 'transit15', cls: 'bus', make: 'Ford', name: 'Transit 15 座', rows: [2, 3, 3, 3, 4], liters: 1200 },
  { id: 'transit12', cls: 'bus', make: 'Ford', name: 'Transit 12 座', rows: [2, 3, 3, 4], liters: 1800 },
  { id: 'express15', cls: 'bus', make: 'Chevrolet', name: 'Express 15 座', rows: [2, 3, 3, 3, 4], liters: 500 },
  { id: 'express12', cls: 'bus', make: 'Chevrolet', name: 'Express 12 座', rows: [2, 3, 3, 4], liters: 1300 },
  { id: 'sprinter12', cls: 'bus', make: 'Mercedes-Benz', name: 'Sprinter 12 座', rows: [2, 3, 3, 4], liters: 1600 },
  { id: 'sprinter15', cls: 'bus', make: 'Mercedes-Benz', name: 'Sprinter 15 座', rows: [2, 3, 3, 3, 4], liters: 1000 },
];

// 搜车型也能用中文品牌名和常见叫法（雪佛兰、Chevy、奔驰、大众…）
const MAKE_ALIASES = {
  Toyota: '丰田', Honda: '本田', Nissan: '日产 尼桑', Hyundai: '现代', Kia: '起亚', Mazda: '马自达', Subaru: '斯巴鲁',
  Mitsubishi: '三菱', Chevrolet: '雪佛兰 chevy', Ford: '福特', GMC: '通用', Buick: '别克', Cadillac: '凯迪拉克', Lincoln: '林肯',
  Jeep: '吉普', Dodge: '道奇', Chrysler: '克莱斯勒', Ram: '道奇 公羊', Tesla: '特斯拉', Rivian: '', Lucid: '', Volkswagen: '大众 vw',
  BMW: '宝马', 'Mercedes-Benz': '奔驰 benz', 'Mercedes-AMG': '奔驰 benz amg', Audi: '奥迪', Porsche: '保时捷', MINI: '迷你',
  Volvo: '沃尔沃', Polestar: '极星', Lexus: '雷克萨斯 凌志', Acura: '讴歌', Infiniti: '英菲尼迪', Genesis: '捷尼赛思',
  'Land Rover': '路虎 揽胜', Jaguar: '捷豹', 'Alfa Romeo': '阿尔法罗密欧', Maserati: '玛莎拉蒂', Fiat: '菲亚特',
  Lamborghini: '兰博基尼', Ferrari: '法拉利', McLaren: '迈凯伦', Bentley: '宾利', 'Rolls-Royce': '劳斯莱斯',
};
// 车型搜索：品牌、车型名、中文品牌名，不分大小写
export const modelSearchText = m => (m.make + ' ' + m.name + ' ' + (MAKE_ALIASES[m.make] || '')).toLowerCase();
export const modelById = id => MODELS.find(m => m.id === id) || null;

// 「其他车型」：自己写名字、几个座、后备箱大概多大
export const TRUNKS = [
  { id: 'S', name: '小（轿车那么大）', liters: 300 },
  { id: 'M', name: '中（五座 SUV）', liters: 650 },
  { id: 'L', name: '大（加长 SUV / 商务车）', liters: 850 },
  { id: 'XL', name: '很大（面包车）', liters: 1300 },
];
export const MIN_SEATS = 2, MAX_SEATS = 15;
// n 个座排成几排：第一排 2 个，后面每排 3 个，最后剩 4 个就排成 2 + 2，剩 1 个就单独一排
export function rowsForSeats(n) {
  const rows = [2];
  let rest = Math.max(0, Math.min(MAX_SEATS, n) - 2);
  while (rest > 0) { const k = rest === 4 ? 2 : Math.min(3, rest); rows.push(k); rest -= k; }
  return rows;
}

// 一辆车（{ model, v, custom }）的座位排法、后备箱、名字
export function layoutOf(car) {
  if (car.model === 'custom') return rowsForSeats(car.custom?.seats || 5);
  const m = modelById(car.model) || modelById('x5');
  return car.v === 1 && m.alt ? m.alt : m.rows;
}
export function trunkOf(car) {
  if (car.model === 'custom') return (TRUNKS.find(t => t.id === car.custom?.trunk) || TRUNKS[1]).liters;
  return (modelById(car.model) || modelById('x5')).liters;
}
export function modelName(car) {
  if (car.model === 'custom') return car.custom?.name || '其他车型';
  const m = modelById(car.model) || modelById('x5');
  return m.make + ' ' + m.name;
}
export const seatCount = rows => rows.reduce((a, b) => a + b, 0);
// 俯视图画哪种车身（CarBody.jsx）：车型表里的按级别；「其他车型」按座位数猜
export function kindOf(car) {
  if (car.model !== 'custom') return (modelById(car.model) || modelById('x5')).cls;
  const n = car.custom?.seats || 5;
  return n <= 2 ? 'coupe' : n <= 5 ? 'sedan' : n <= 9 ? 'suv3' : 'bus';
}
// 「Chevrolet Suburban（8 座）」；名字里已经带着几座的（Transit 15 座）就不再重复
export function modelTitle(car) {
  const n = modelName(car);
  return /座$/.test(n) ? n : n + '（' + seatCount(layoutOf(car)) + ' 座）';
}
export const rowsText = rows => rows.join('+');

// 座位 id：第一排 driver / front（三个就是 driver / frontMiddle / front），第二排 rearLeft /
// rearMiddle / rearRight（两个就是 rearLeft / rearRight）——和以前三辆 X5 存下来的座位一样；
// 第三排起 r3-1、r3-2…（从左往右）。
export function seatIds(rows) {
  return rows.flatMap((k, r) => {
    if (r === 0) return k === 3 ? ['driver', 'frontMiddle', 'front'] : k === 1 ? ['driver'] : ['driver', 'front'];
    if (r === 1) return k === 3 ? ['rearLeft', 'rearMiddle', 'rearRight'] : k === 2 ? ['rearLeft', 'rearRight'] : k === 1 ? ['rearMiddle'] : Array.from({ length: k }, (_, i) => 'r2-' + (i + 1));
    return Array.from({ length: k }, (_, i) => 'r' + (r + 1) + '-' + (i + 1));
  });
}
const ROW_NAMES = ['前排', '二排', '三排', '四排', '五排'];
const SIDE = { 1: ['中'], 2: ['左', '右'], 3: ['左', '中', '右'], 4: ['左', '中左', '中右', '右'] };
// 座位的中文名：主驾、副驾、后排左（两排的车）/ 二排左、三排中…
export function seatName(id, rows) {
  if (id === 'driver') return '主驾';
  if (id === 'front') return '副驾';
  if (id === 'frontMiddle') return '前排中';
  const ids = seatIds(rows);
  let at = ids.indexOf(id);
  if (at < 0) return id;
  for (let r = 0; r < rows.length; r++) {
    if (at < rows[r]) {
      const row = rows.length === 2 && r === 1 ? '后排' : ROW_NAMES[r] || (r + 1) + '排';
      return row + ((SIDE[rows[r]] || [])[at] || (at + 1));
    }
    at -= rows[r];
  }
  return id;
}
