export const STORE_NAME = 'Fieldhouse'

export const COLORS = {
  black: 'BLK',
  white: 'WHT',
  gray: 'GRY',
  charcoal: 'CHR',
  navy: 'NVY',
  blue: 'BLU',
  olive: 'OLV',
  green: 'GRN',
  red: 'RED',
  orange: 'ORG',
  sand: 'SND',
  pink: 'PNK',
  purple: 'PRP',
}

export const MENS_SHOE_SIZES = ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13', '14']
export const WOMENS_SHOE_SIZES = ['5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11']
export const APPAREL_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

export const MODEL_WORDS = [
  'Arc', 'Atlas', 'Beacon', 'Canyon', 'Coast', 'Crest', 'Drift', 'Echo', 'Ember', 'Flux',
  'Harbor', 'Horizon', 'Kestrel', 'Lumen', 'Mesa', 'Nimbus', 'Orbit', 'Pace', 'Pulse', 'Quill',
  'Rally', 'Ridge', 'Sable', 'Solace', 'Strata', 'Summit', 'Swift', 'Tempo', 'Terra', 'Tide',
  'Vector', 'Vista', 'Zephyr', 'Cinder', 'Granite', 'Juniper',
]

export const APPAREL_WORDS = [
  'Everyday', 'Heavyweight', 'Lightweight', 'Studio', 'Trail', 'Club', 'Core', 'Essential',
  'Tech', 'Thermal', 'Breeze', 'Weekend', 'Track', 'Harbor', 'Summit', 'Coast', 'Ridge', 'Tempo',
]

// Words that make a product a logo or graphic piece, for "no logos" briefs.
export const LOGO_WORDS = { Logo: 'logo', Graphic: 'graphic', Varsity: 'logo', Script: 'logo' }

export const FOOTWEAR = [
  { category: 'road-running', code: 'RUN', count: 40, nouns: ['Runner', 'Racer', 'Glide', 'Road'], price: [100, 180], upper: ['engineered mesh', 'knit', 'jacquard mesh'] },
  { category: 'trail-running', code: 'TRL', count: 25, nouns: ['Trail', 'Trek', 'Scramble'], price: [110, 190], upper: ['ripstop mesh', 'engineered mesh'] },
  { category: 'training', code: 'TRN', count: 20, nouns: ['Trainer', 'Cross', 'Lift'], price: [80, 140], upper: ['synthetic leather', 'engineered mesh', 'knit'] },
  { category: 'lifestyle', code: 'LIF', count: 15, nouns: ['Court', 'Classic', 'Low', 'Mid'], price: [70, 130], upper: ['leather', 'canvas', 'suede'] },
]

export const APPAREL = [
  { category: 'hoodies', code: 'HOD', count: 50, nouns: ['Hoodie', 'Pullover Hoodie', 'Zip Hoodie', 'Fleece Hoodie'], price: [55, 95], fabric: ['80% cotton, 20% polyester', '100% organic cotton', '60% cotton, 40% recycled polyester'] },
  { category: 'joggers', code: 'JOG', count: 45, nouns: ['Jogger', 'Fleece Jogger', 'Track Pant', 'Sweatpant'], price: [50, 90], fabric: ['80% cotton, 20% polyester', '100% organic cotton', '92% polyester, 8% elastane'] },
  { category: 'tees', code: 'TEE', count: 60, nouns: ['Tee', 'Run Tee', 'Long Sleeve Tee', 'Pocket Tee'], price: [25, 45], fabric: ['100% cotton', '100% organic cotton', '100% recycled polyester'] },
  { category: 'shorts', code: 'SHO', count: 40, nouns: ['Short', 'Run Short', '5-Inch Short', '7-Inch Short'], price: [30, 60], fabric: ['100% recycled polyester', '88% polyester, 12% elastane', '100% nylon'] },
  { category: 'jackets', code: 'JKT', count: 35, nouns: ['Jacket', 'Shell', 'Windbreaker', 'Puffer'], price: [90, 220], fabric: ['100% recycled nylon', '100% polyester', 'nylon shell, recycled down fill'] },
  { category: 'leggings', code: 'LEG', count: 30, nouns: ['Legging', 'High-Rise Legging', 'Tight', '7/8 Legging'], price: [50, 98], fabric: ['78% nylon, 22% elastane', '88% polyester, 12% elastane'] },
  { category: 'socks', code: 'SOC', count: 20, nouns: ['Run Sock', 'Crew Sock', 'No-Show Sock', 'Trail Sock'], price: [12, 20], fabric: ['merino wool blend', '75% recycled polyester, 25% nylon'] },
  { category: 'caps', code: 'CAP', count: 20, nouns: ['Cap', 'Run Cap', 'Five-Panel Cap', 'Beanie'], price: [25, 35], fabric: ['100% recycled polyester', '100% cotton twill', '100% merino wool'] },
]

export const STORES = [
  {
    id: 'downtown',
    name: 'Downtown',
    address: '812 S Broadway, Los Angeles, CA 90014',
    hours: { mon: '10:00-20:00', tue: '10:00-20:00', wed: '10:00-20:00', thu: '10:00-20:00', fri: '10:00-21:00', sat: '10:00-21:00', sun: '11:00-18:00' },
  },
  {
    id: 'venice',
    name: 'Venice',
    address: '1421 Abbot Kinney Blvd, Venice, CA 90291',
    hours: { mon: '11:00-19:00', tue: '11:00-19:00', wed: '11:00-19:00', thu: '11:00-19:00', fri: '11:00-20:00', sat: '10:00-20:00', sun: '10:00-19:00' },
  },
  {
    id: 'pasadena',
    name: 'Pasadena',
    address: '58 E Colorado Blvd, Pasadena, CA 91105',
    hours: { mon: '10:00-19:00', tue: '10:00-19:00', wed: '10:00-19:00', thu: '10:00-19:00', fri: '10:00-20:00', sat: '10:00-20:00', sun: '11:00-17:00' },
  },
]

export const DAYS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
