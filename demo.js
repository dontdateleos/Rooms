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
];
const COMING = [
  ["film:20","film","The Bride!","2026","Maggie Gyllenhaal",0,"#FF8E6E","#C96A52", soon(38)],
  ["game:20","game","Ghost of Yotei","2026","Sucker Punch",0,"#8FD3FF","#5B9AC6", soon(72)],
];

const works = {};
for (const [id,kind,title,year,creator,length,a,b,release] of [...WORKS, ...COMING]) {
  works[id] = { id, kind, title, year, creator, length, cover:poster(title, a, b),
    meta:{}, credits:{ director:creator }, ...(release ? { release } : {}) };
}

const PEOPLE = [
  { id:"u-mo",   handle:"mo",   bio:"Watches everything twice." },
  { id:"u-ali",  handle:"ali",  bio:"Books mostly. Films under duress." },
  { id:"u-cass", handle:"cass", bio:"" },
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
  ["u-cass","film:7",8,11,"That last shot.",["the ending"]],

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
];

const entries = LOG.map(([u,w,score,d,note,loved], i) => ({
  id:"e" + i, user_id:u, work_id:w, score, rated_on:day(d),
  note:note || null, loved:loved.length ? loved : null,
  breakdown:null, context:null, room_only:false, created_at:ago(d),
}));

const eid = (u,w) => entries.find(e => e.user_id === u && e.work_id === w)?.id;

export function demoSeed() {
  return {
    profile:{ id:"me", handle:"jord", bio:"Four mediums, one shelf.", avatar:null,
      created_at:ago(1180) },
    signedOut:false,
    profiles:PEOPLE.map(p => ({ ...p, avatar:null, created_at:ago(900) })),
    works,
    entries,

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

    top_lists:[{ id:"t1", owner:"me", name:"all time", created_at:ago(200) }],
    top_list_items:["tv:1","game:1","film:1","book:2","film:6"]
      .map((work_id, i) => ({ top_list_id:"t1", work_id, rank:i + 1 })),

    follows:[{ follower:"me", followee:"u-rue" }, { follower:"me", followee:"u-ali" },
      { follower:"u-mo", followee:"me" }, { follower:"u-cass", followee:"me" }],
  };
}
