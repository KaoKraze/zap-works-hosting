// =========================================================
// Zap Works — tracked data sources
// Reference for the live stats server (server.js).
// =========================================================

const games = [
  { placeId: 18959440414, name: "ART-244" },
  { placeId: 7146923630, name: "XPLOR" },
  { placeId: 7171174521, name: "American Plains Mudding" },
  { placeId: 89358562219139, name: "Block Breakout" },
  { placeId: 2418863943, name: "Roanoke VA Driving RP" },
  { placeId: 136162036182779, name: "German Voice" },
  { placeId: 130142513744311, name: "Formula V8 Racing" },
  { placeId: 15736062694, name: "Bay Takeovers" },
  { placeId: 13843265135, name: "Prostreet Takeoverz" },
  { placeId: 1554960397, name: "Car Dealership Tycoon" },
  { placeId: 107023775148165, name: "Case Unboxing Simulator" },
  { placeId: 104804759151467, name: "Escape Tsunami on Bike" },
  { placeId: 70928272327952, name: "Steal Lucky Blocks" },
  { placeId: 113328028898605, name: "Steal from Brainrots on Bike" },
  { placeId: 74305716507552, name: "Troll Players Tower" },
  { placeId: 89106073769521, name: "1 Speed ASMR Escape Lemon-Lime" },
  { placeId: 88568708661469, name: "Sniper VS Tower" },
  { placeId: 79397738734352, name: "Find the 67s" },
  { placeId: 88906997465041, name: "Troll Scary Worm Tower" },
  { placeId: 87305498970773, name: "Tsunami VS Tower" },
  { placeId: 18451693875, name: "Escape Chasing Head" },
  { placeId: 122173773486852, name: "Slapping Tower" },
  { placeId: 114057014873818, name: "Banana Peel Tower" },
  { placeId: 77794329637400, name: "Squid Game Troll Tower" },
  { placeId: 124314803600260, name: "Fight to Steal Brainrot" },
  { placeId: 74941162320079, name: "Admin Abuse Tower" },
  { placeId: 82181388777170, name: "Trolls Won't Like This Tower" },
  { placeId: 138829920561362, name: "1 Speed ASMR Escape Needoh Butter" },
  { placeId: 105652710671644, name: "Launch Tower" },
  { placeId: 118305286816148, name: "Cheese ASMR Tower" },
  { placeId: 127490152818808, name: "Escape Boss Cat Head" },
  { placeId: 128749224600370, name: "1 Speed Brainrot Run" },
  { placeId: 75277020710453, name: "Toy Car Tycoon" },
  { placeId: 98048527747505, name: "Berry Incremental" }
];

const groups = [
  { groupId: 4745869, name: "XPLOR" },
  { groupId: 34789496, name: "REVOL GAMES" },
  { groupId: 4548068, name: "American Plains Mudding" },
  { groupId: 838781482, name: "Schwiii Fanclub" },
  { groupId: 4451448, name: "Roanoke VA" },
  { groupId: 2806223, name: "German Voice Community" },
  { groupId: 35808395, name: "Formula Roblox V8 Series" },
  { groupId: 33549390, name: "Bay Takeovers" },
  { groupId: 3955051, name: "Foxzie" },
  { groupId: 32521375, name: "NBS Productions" },
  { groupId: 33798992, name: "Zaps Games" },
  { groupId: 35558689, name: "ZAP Works" },
  { groupId: 86236032, name: "ZAP Interactives" },
  { groupId: 35814994, name: "Toy Car Tycoon" }
];

// Discord servers — live member/online counts pulled from each invite.
const discord = [
  { code: "apm", name: "American Plains Mudding" },
  { code: "foxzie", name: "Foxzie" },
  { code: "5J3erND7sQ", name: "Zap Community" },
  { code: "z6TF7EDcZf", name: "Zap Community" },
  { code: "7EXhMcdKtY", name: "Zap Community" },
  { code: "uHKSf2z7HC", name: "Zap Community" },
  { code: "4DrKYZcupH", name: "Zap Community" },
  { code: "vDfUEmQQTe", name: "Zap Community" },
  { code: "384JBmk7By", name: "Zap Community" },
  { code: "8ePUqpdWGu", name: "Zap Community" }
];

module.exports = { games, groups, discord };
