/* ============ demo mode ============
   Loaded only when the URL says #demo. Everything here is invented: the people, the
   entries, the arguments. It is handed to makeLocalSb as a seed, and a seeded local
   client never writes to localStorage — so a demo runs entirely in memory, touches
   nothing real, and resets on refresh.

   Covers are drawn rather than fetched. Real posters would need a TMDB key at page
   load and would break the moment one path went stale; these always render, work
   offline, and are in the app's own palette. Anything added through search during a
   demo gets its real poster as normal. */

const INK = "#151320";
const poster = (title, a, b) => "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="200" height="300" fill="url(#g)"/>
    <text x="16" y="272" font-family="Outfit,Trebuchet MS,sans-serif" font-weight="800"
      font-size="19" fill="${INK}" opacity=".92">${title.replace(/[<&>]/g,"")}</text>
  </svg>`);

const day = n => { const d = new Date(Date.now() - n * 864e5);
  return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const ago = n => new Date(Date.now() - n * 864e5).toISOString();
const soon = n => day(-n);

/* id, kind, title, year, creator, length, two colours */
const WORKS = [
  ["film:1","film","Heat","1995","Michael Mann",170,"#FF8E6E","#D8604A"],
  ["film:2","film","Thief","1981","Michael Mann",123,"#F5A3C7","#C97BA0"],
  ["film:3","film","Collateral","2004","Michael Mann",120,"#B9A6FF","#8B79D6"],
  ["film:4","film","The Insider","1999","Michael Mann",157,"#FFB36B","#D68B45"],
  ["film:5","film","Sexy Beast","2000","Jonathan Glazer",89,"#9EF0C9","#66C79B"],
  ["film:6","film","The Zone of Interest","2023","Jonathan Glazer",105,"#7A7590","#4E4A60"],
  ["film:7","film","Past Lives","2023","Celine Song",105,"#FFE86A","#D6BE3E"],
  ["film:8","film","Aftersun","2022","Charlotte Wells",102,"#8FD3FF","#5FA5D6"],
  ["film:9","film","Michael Clayton","2007","Tony Gilroy",119,"#FF8E6E","#C96A52"],
  ["tv:1","tv","The Wire","2002","David Simon",59,"#9EF0C9","#5FB994"],
  ["tv:2","tv","The Leftovers","2014","Damon Lindelof",58,"#B9A6FF","#7E6DC4"],
  ["tv:3","tv","Slow Horses","2022","Will Smith",48,"#FFB36B","#CF8A48"],
  ["book:1","book","Dune","1965","Frank Herbert",412,"#FFE86A","#CBB13B"],
  ["book:2","book","Pachinko","2017","Min Jin Lee",496,"#F5A3C7","#C0779B"],
  ["book:3","book","Trust","2022","Hernan Diaz",416,"#8FD3FF","#5C9CC4"],
  ["game:1","game","Outer Wilds","2019","Mobius Digital",22,"#9EF0C9","#5AAE89"],
  ["game:2","game","Disco Elysium","2019","ZA/UM",30,"#B9A6FF","#8271CC"],
  /* a few horror titles, so the Halloween season has something on its calendar */
  ["film:30","film","The Thing","1982","John Carpenter",109,"#8FD3FF","#4E7E9C"],
  ["film:31","film","Hereditary","2018","Ari Aster",127,"#FF8E6E","#9C4636"],
  ["film:32","film","The Witch","2015","Robert Eggers",92,"#9EF0C9","#4F7E66"],
  ["tv:30","tv","The Haunting of Hill House","2018","Mike Flanagan",10,"#B9A6FF","#5E4E96"],
  ["book:30","book","Mexican Gothic","2020","Silvia Moreno-Garcia",301,"#F5A3C7","#9C5376"],
];
const COMING = [
  ["film:20","film","The Bride!","2026","Maggie Gyllenhaal",0,"#FF8E6E","#C96A52", soon(38)],
  ["game:20","game","Ghost of Yotei","2026","Sucker Punch",0,"#8FD3FF","#5B9AC6", soon(72)],
];

/* "something tense", "something by him" — genre and director are how the pick chips
   narrow a shelf, so the demo carries them or the chips have nothing to offer */
const GENRES = {
  "film:1":["Crime","Thriller"], "film:2":["Crime","Drama"], "film:3":["Thriller","Crime"],
  "film:4":["Drama","Thriller"], "film:5":["Crime","Comedy"], "film:6":["Drama","History"],
  "film:7":["Drama","Romance"], "film:8":["Drama"], "film:9":["Thriller","Drama"],
  "tv:1":["Crime","Drama"], "tv:2":["Drama","Mystery"], "tv:3":["Thriller","Comedy"],
  "book:1":["Science fiction"], "book:2":["Drama","History"], "book:3":["Drama","History"],
  "game:1":["Adventure","Mystery"], "game:2":["Role-playing","Mystery"],
  "film:20":["Horror","Romance"], "game:20":["Adventure","Action"],
  "film:30":["Horror","Science Fiction"], "film:31":["Horror","Drama"], "film:32":["Horror","Mystery"],
  "tv:30":["Drama","Horror","Mystery"], "book:30":["Horror fiction","Gothic"],
};
/* what the pick wheel shows under a spun title — the shelf's things, since those are
   what the wheel lands on. Written for the demo, not lifted from anywhere. */
const ABOUT = {
  "film:2":"A professional safecracker who works alone and plans everything wants one last score so he can buy a normal life — and takes a job from the one man he shouldn't.",
  "film:4":"A tobacco company scientist is pushed out and decides to talk on television about what his old employer knew. A news producer tries to get the interview on air before the lawyers bury it.",
  "tv:2":"Three years after two percent of the world's population vanished without a trace, a police chief in a small New York town tries to hold his family and his town together as both come apart.",
  "book:3":"A Gilded Age financier's fortune, told four times over — a novel, a memoir, a draft, a diary — each version of the story undercutting the one before it.",
  "game:2":"You wake up in a wrecked hostel room with no memory and a dead man hanging in the yard. You're a detective, apparently. Your own head argues with you about everything.",
  "film:20":"A lonely Frankenstein asks a pioneering scientist to build him a companion in 1930s Chicago, and what she brings back to life has plans of her own.",
  "game:20":"An open-world samurai story set in the far north of Japan around 1603, following a lone warrior hunting the gang that destroyed her family.",
};
/* who's in them, so Finished can show your favourites with a given actor */
const CAST = {
  "film:1":"Al Pacino, Robert De Niro, Val Kilmer, Tom Sizemore",
  "film:2":"James Caan, Tuesday Weld, Willie Nelson, Jim Belushi",
  "film:3":"Tom Cruise, Jamie Foxx, Jada Pinkett Smith, Mark Ruffalo",
  "film:4":"Al Pacino, Russell Crowe, Christopher Plummer, Diane Venora",
  "film:5":"Ray Winstone, Ben Kingsley, Ian McShane, Amanda Redman",
  "film:6":"Christian Friedel, Sandra Hüller",
  "film:7":"Greta Lee, Teo Yoo, John Magaro",
  "film:8":"Paul Mescal, Frankie Corio, Celia Rowlson-Hall",
  "film:9":"George Clooney, Tilda Swinton, Tom Wilkinson, Sydney Pollack",
  "film:30":"Kurt Russell, Wilford Brimley, Keith David",
  "film:31":"Toni Collette, Alex Wolff, Milly Shapiro, Gabriel Byrne",
  "film:32":"Anya Taylor-Joy, Ralph Ineson, Kate Dickie",
  "tv:1":"Dominic West, Idris Elba, Wendell Pierce, Lance Reddick",
  "tv:2":"Justin Theroux, Carrie Coon, Christopher Eccleston, Amy Brenneman",
  "tv:3":"Gary Oldman, Jack Lowden, Kristin Scott Thomas, Saskia Reeves",
  "tv:30":"Carla Gugino, Michiel Huisman, Elizabeth Reaser, Victoria Pedretti",
};
const works = {};
for (const [id,kind,title,year,creator,length,a,b,release] of [...WORKS, ...COMING]) {
  works[id] = { id, kind, title, year, creator, length, cover:poster(title, a, b),
    meta:{ genres:GENRES[id] || [], ...(ABOUT[id] ? { overview:ABOUT[id] } : {}) },
    credits:{ director:creator, ...(CAST[id] ? { cast:CAST[id] } : {}) }, ...(release ? { release } : {}) };
}

const PEOPLE = [
  { id:"u-mo",   handle:"mo",   bio:"Watches everything twice.", goals:{ "2026":18 } },
  { id:"u-ali",  handle:"ali",  bio:"Books mostly. Films under duress.", goals:{ "2026":8 } },
  { id:"u-cass", handle:"cass", bio:"", goals:{ "2026":9 } },
  { id:"u-rue",  handle:"rue",  bio:"Here for the arguments." },
];

/* user, work, score (half-stars 1..10), days ago, note, tags */
const LOG = [
  ["me","film:1",9,3,"Still the best shootout ever put on film. The diner scene is the whole thing in six minutes.",["the writing","the look"]],
  ["u-mo","film:1",9,4,"Two men explaining themselves to each other over coffee. Perfect.",["the writing"]],
  ["u-ali","film:1",6,9,"Long.",["the look"]],
  ["u-cass","film:1",8,6,"",["the score"]],
  ["u-rue","film:1",10,2,"I will not be taking questions.",["the writing","the acting"]],

  ["me","film:6",9,8,"Sound design doing all the work. I've thought about it every day since.",["the sound","the direction"]],
  ["u-mo","film:6",9,7,"",["the sound"]],
  ["u-ali","film:6",4,5,"Admired it. Never want to see it again.",["the direction"]],
  ["u-cass","film:6",3,4,"Didn't land for me at all.",[]],
  ["u-rue","film:6",9,6,"The best thing anyone made that year.",["the sound","the direction"]],

  ["me","film:7",8,14,"Quiet and enormous.",["the writing","the acting"]],
  ["u-mo","film:7",9,12,"",["the acting"]],
  ["u-cass","film:7",8,11,"That last shot. ||She walks him to the car and doesn't say it, and then she cries on the way back.||",["the ending"]],

  ["me","tv:1",10,30,"",["the writing","the acting"]],
  ["u-mo","tv:1",10,26,"Season four is the best television there is.",["the writing"]],
  ["u-rue","tv:1",9,22,"",["the writing"]],

  ["me","game:1",10,40,"The only game I'd call a masterpiece without flinching.",["the ending","the atmosphere"]],
  ["u-cass","game:1",9,35,"",["the atmosphere"]],
  ["me","game:2",8,52,"",["the writing"]],
  ["u-rue","game:2",10,48,"Twelve hours in a fictional country and I still miss it.",["the writing"]],

  ["me","book:2",9,64,"Four generations and it never once feels like homework.",["the writing"]],
  ["u-ali","book:2",10,60,"The best novel I've read in five years.",["the writing"]],
  ["u-ali","book:3",9,20,"",["the writing","the structure"]],
  ["me","book:1",7,90,"",["the atmosphere"]],

  ["me","film:8",9,18,"",["the look","the acting"]],
  ["u-mo","film:8",8,16,"",["the look"]],
  ["me","film:5",8,44,"Kingsley walks in and ruins everyone's holiday.",["the acting"]],
  ["u-mo","film:5",8,42,"",["the acting"]],
  ["me","tv:3",7,10,"",["the acting"]],
  ["u-cass","tv:3",8,9,"",["the acting"]],
  ["me","film:9",9,70,"Everything I've rated highly I tagged for the writing. This is why.",["the writing"]],
  ["u-mo","film:2",8,50,"",["the look"]],
  ["u-mo","film:3",7,33,"",["the look"]],
  ["u-cass","film:3",9,31,"LA has never looked like that before or since.",["the look"]],
  /* logged and nothing said: these fold into one line in the room */
  ["u-mo","tv:2",8,1,"",[]],
  ["u-mo","book:3",7,1,"",[]],
  ["u-mo","game:2",9,1,"",[]],
  ["u-ali","film:9",7,1.5,"",[]],
  /* the Halloween season: a few nights each, so the calendar and the room's race have life */
  ["me","film:31",9,18,"Not a jump scare in it and I didn't sleep.",["the acting"]],
  ["me","book:30",8,11,"",[]],
  ["me","film:32",8,4,"",["the look"]],
  ["u-mo","film:30",10,20,"The blood test. Every time.",["the writing"]],
  ["u-mo","tv:30",9,13,"",[]],
  ["u-mo","film:31",8,8,"",[]],
  ["u-mo","book:30",8,5,"",[]],
  ["u-cass","film:32",9,15,"",["the look"]],
  ["u-cass","film:30",8,10,"",[]],
  ["u-ali","film:31",7,3,"",[]],
];

const entries = LOG.map(([u,w,score,d,note,loved], i) => ({
  id:"e" + i, user_id:u, work_id:w, score, rated_on:day(d),
  note:note || null, loved:loved.length ? loved : null,
  breakdown:null, context:null, room_only:false, created_at:ago(d),
}));

/* The Wire, season one, so a show's page has episodes to open — and two of them have
   something said about them: one you've seen, one you haven't, which stays shut */
works["tv:1:s1"] = { id:"tv:1:s1", parent_id:"tv:1", kind:"tv", title:"Season 1", year:"2002", length:4, cover:works["tv:1"].cover, meta:{} };
[["The Target"],["The Detail"],["The Buys"],["Old Cases"]].forEach(([title], i) => {
  works[`tv:1:s1e${i + 1}`] = { id:`tv:1:s1e${i + 1}`, parent_id:"tv:1:s1", kind:"tv", title, year:"2002", length:59, meta:{} }; });
entries.push(
  { id:"ep1", user_id:"u-mo", work_id:"tv:1:s1e2", score:9, rated_on:day(9), note:"The chess scene. ||D'Angelo explaining the board to Bodie is the whole show in five minutes.||", loved:null, breakdown:null, context:null, room_only:false, part:true, created_at:ago(9) },
  { id:"ep2", user_id:"u-cass", work_id:"tv:1:s1e3", score:8, rated_on:day(6), note:"Did not see that ending coming. ||Wallace.||", loved:null, breakdown:null, context:null, room_only:false, part:true, created_at:ago(6) },
  { id:"ep3", user_id:"u-rue", work_id:"tv:1:s1e3", score:10, rated_on:day(5), note:"Best episode so far and it isn't close.", loved:null, breakdown:null, context:null, room_only:false, part:true, created_at:ago(5) });

const eid = (u,w) => entries.find(e => e.user_id === u && e.work_id === w)?.id;

/* the games run on the calendar, so the demo's are pinned to whenever it's opened:
   this week's prompt is half answered (you haven't), last week's is decided, and the
   month's bracket is one round in */
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monday = back => { const d = new Date(); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - back * 7); return ymd(d); };
const WK = monday(0), LASTWK = monday(1), MONTH = ymd(new Date()).slice(0, 7);
const SEEDS = ["film:1","film:7","film:6","film:3","film:5","film:8","film:2","film:9"];
const answers = [
  ["u-mo",   WK, "film:8", "Watch it, then call your dad."],
  ["u-cass", WK, "film:7", "Twenty-four years in two hours and nobody raises their voice."],
  ["u-ali",  WK, "book:2", null],
  ["me",     LASTWK, "film:1", "The diner scene alone is worth the three hours."],
  ["u-mo",   LASTWK, "film:6", "You won't sleep, but you'll understand why."],
  ["u-rue",  LASTWK, "film:5", "Ben Kingsley as a weather system."],
  ["u-cass", LASTWK, "film:3", "Tom Cruise, grey hair, a taxi. Done."],
].map(([user_id, week, work_id, pitch]) => ({ room_id:"r1", week, user_id, work_id, pitch, created_at:ago(3) }));
const vote = (game, voter, choice, d = 2) => ({ room_id:"r1", game, voter, choice, created_at:ago(d) });
const roomVotes = [
  ...[["me","u-rue"],["u-mo","me"],["u-rue","me"],["u-cass","u-mo"]].map(([v, c]) => vote("prompt:" + LASTWK, v, c, 4)),
  /* the quarter-finals; the pairs are seeds 1v8, 4v5, 2v7, 3v6 */
  ...[["me","film:1"],["u-mo","film:1"],["u-ali","film:9"],["u-cass","film:1"],["u-rue","film:1"]].map(([v, c]) => vote(`bracket:${MONTH}:1:0`, v, c, 6)),
  ...[["me","film:5"],["u-mo","film:3"],["u-ali","film:5"],["u-cass","film:3"],["u-rue","film:5"]].map(([v, c]) => vote(`bracket:${MONTH}:1:1`, v, c, 6)),
  ...[["me","film:7"],["u-mo","film:7"],["u-ali","film:2"],["u-cass","film:7"],["u-rue","film:2"]].map(([v, c]) => vote(`bracket:${MONTH}:1:2`, v, c, 6)),
  ...[["me","film:6"],["u-mo","film:6"],["u-ali","film:8"],["u-cass","film:8"],["u-rue","film:6"]].map(([v, c]) => vote(`bracket:${MONTH}:1:3`, v, c, 6)),
  /* the semis have started without you */
  vote(`bracket:${MONTH}:2:0`, "u-mo", "film:1", 1), vote(`bracket:${MONTH}:2:0`, "u-cass", "film:5", 1),
  vote(`bracket:${MONTH}:2:1`, "u-mo", "film:6", 1),
  /* mo has put Saturday to the room; two of you have voted */
  vote("night:n1", "u-mo", "film:4", 1), vote("night:n1", "u-cass", "film:2", 1),
  /* and two of them are swiping for tonight: one match already, Slow Horses still open */
  ...[["u-mo","tv:3","y"],["u-mo","film:8","y"],["u-mo","film:5","y"],["u-cass","film:8","y"],["u-cass","tv:3","n"]].map(([v, w, c]) => vote(`swipe:${day(0)}:${w}`, v, c, 0.05)),
];

export function demoSeed() {
  return {
    profile:{ id:"me", handle:"jord", bio:"Four mediums, one shelf.", avatar:null, goals:{ "2026":20 },
      created_at:ago(1180) },
    signedOut:false,
    profiles:PEOPLE.map(p => ({ ...p, avatar:null, created_at:ago(900) })),
    works,
    entries,
    seen:[{ user_id:"me", work_id:"tv:1:s1e1" }, { user_id:"me", work_id:"tv:1:s1e2" }],
    /* what people are partway through, so the room's "on now" strip has bars and a next episode */
    nows:[
      { user_id:"u-ali", work_id:"book:2", started_on:day(12), at:"p. 310 of 496", updated_at:ago(.2) },
      { user_id:"u-mo", work_id:"tv:2", started_on:day(5), at:"S2 E4", updated_at:ago(.5) },
      { user_id:"u-cass", work_id:"game:2", started_on:day(9), at:"40%", updated_at:ago(1) },
    ],

    lists:[{ id:"L1", owner:"me", name:"the shelf", created_at:ago(400) }],
    list_items:["film:2","film:4","tv:2","book:3","game:2","film:20","game:20"]
      .map((work_id, i) => ({ list_id:"L1", work_id, added_at:ago(30 - i), position:null })),

    rooms:[{ id:"r1", name:"The Pit", code:"PIT42X", created_at:ago(300) }],
    room_members:[["me",300],["u-mo",298],["u-ali",240],["u-cass",120],["u-rue",90]]
      .map(([user_id, d]) => ({ room_id:"r1", user_id, joined_at:ago(d) })),

    clubs:[{ id:"c1", room_id:"r1", name:"Sunday Club", scope:"room",
      items:["film:1","film:2","film:3","film:4","film:5","film:6","film:7"],
      due:null, closed_at:null, created_by:"me", created_at:ago(60) }],
    club_members:[
      { club_id:"c1", user_id:"me",     joined_at:ago(60), started_at:ago(60), finished_at:null },
      { club_id:"c1", user_id:"u-mo",   joined_at:ago(59), started_at:ago(59), finished_at:null },
      { club_id:"c1", user_id:"u-cass", joined_at:ago(40), started_at:ago(40), finished_at:null },
    ],
    club_votes:[],

    reactions:[
      { entry_id:eid("me","film:1"),  user_id:"u-mo" },
      { entry_id:eid("me","film:1"),  user_id:"u-rue" },
      { entry_id:eid("me","film:6"),  user_id:"u-rue" },
      { entry_id:eid("u-rue","film:1"), user_id:"me" },
      { entry_id:eid("u-ali","book:2"), user_id:"me" },
    ].filter(r => r.entry_id),
    replies:[
      { id:"r-1", entry_id:eid("me","film:6"), user_id:"u-cass",
        body:"Genuinely don't understand what you all hear in this.", created_at:ago(4) },
      { id:"r-2", entry_id:eid("me","film:6"), user_id:"me",
        body:"That's the point though — you're not supposed to be able to stop hearing it.", created_at:ago(3) },
      { id:"r-3", entry_id:eid("me","film:1"), user_id:"u-ali",
        body:"It is however still very long.", created_at:ago(2) },
    ].filter(r => r.entry_id),

    top_lists:[{ id:"t1", owner:"me", name:"all time", created_at:ago(200) },
      { id:"t2", owner:"u-mo", name:"rank:film", created_at:ago(40) },
      { id:"t3", owner:"u-cass", name:"rank:film", created_at:ago(30) }],
    top_list_items:[
      ...["tv:1","game:1","film:1","book:2","film:6"].map((work_id, i) => ({ top_list_id:"t1", work_id, rank:i + 1 })),
      ...["film:1","film:6","film:7","film:8","film:5","film:2","film:3"].map((work_id, i) => ({ top_list_id:"t2", work_id, rank:i + 1 })),
      ...["film:3","film:7","film:1","film:5","film:6"].map((work_id, i) => ({ top_list_id:"t3", work_id, rank:i + 1 })),
    ],

    room_answers:answers,
    room_votes:roomVotes,
    room_asks:[{ id:"a1", room_id:"r1", user_id:"u-cass", body:"Something short and tense for Friday? Under two hours.", closed:false, created_at:ago(1) }],
    room_ask_answers:[{ ask_id:"a1", user_id:"u-mo", work_id:"film:5", note:"89 minutes and Ben Kingsley never blinks.", created_at:ago(0.8) }],
    room_nights:[{ id:"n1", room_id:"r1", at:soon(2), options:["film:2","film:4","film:9"], created_by:"u-mo", created_at:ago(1) }],
    room_brackets:[{ room_id:"r1", month:MONTH, kind:"film", seeds:SEEDS, created_by:"u-mo", created_at:ago(20) }],

    follows:[{ follower:"me", followee:"u-rue" }, { follower:"me", followee:"u-ali" },
      { follower:"u-mo", followee:"me" }, { follower:"u-cass", followee:"me" }],
  };
}
