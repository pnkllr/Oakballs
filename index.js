// index.js
// Requires: discord.js ^13.8.0, tmi.js ^1.8.5, dotenv ^16, node-fetch ^2
require('dotenv').config();

const tmi = require('tmi.js');
const { Client, Intents } = require('discord.js');
const fs = require('fs/promises');
const path = require('path');
const fetch = require('node-fetch');

// --------------------------
// Config
// --------------------------
const GENERAL_CHANNEL_ID = process.env.GENERAL_CHANNEL_ID || '1403975109735350395';
const STREAM_CHANNEL_ID = process.env.STREAM_CHANNEL_ID || '1406543359647940700';

// Make CHANNEL_NAME robust (strip leading '#', allow fallback)
const TWITCH_CHANNEL_NAME = ((process.env.CHANNEL_NAME || '').replace(/^#/, '').trim()) || 'pnkllr';
const TWITCH_CHANNEL = `#${TWITCH_CHANNEL_NAME}`;

const DATA_FILE = path.resolve(__dirname, 'values.json');
const BLOCKED_WORDS = ['f4f', 'follow me'];

// --------------------------
// Persistent Counters (with simple write queue)
// --------------------------
let data = { dead: 0, fall: 0 };
let _writeInFlight = Promise.resolve();

async function loadData() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.dead === 'number') data.dead = parsed.dead;
    if (typeof parsed.fall === 'number') data.fall = parsed.fall;
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
  }
}
function saveData(next = data) {
  _writeInFlight = _writeInFlight.then(() =>
    fs.writeFile(DATA_FILE, JSON.stringify(next, null, 2)).catch(err => {
      console.error('Failed to write values.json:', err);
    })
  );
  return _writeInFlight;
}

// --------------------------
// Twitch Helix (for viewer count)
// --------------------------
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

let _twitchAppToken = null;
let _twitchAppTokenExpiry = 0;

async function getTwitchAppToken() {
  const now = Date.now();
  if (_twitchAppToken && now < _twitchAppTokenExpiry - 60_000) {
    return _twitchAppToken; // not expiring within 60s
  }
  const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(TWITCH_CLIENT_ID)}&client_secret=${encodeURIComponent(TWITCH_CLIENT_SECRET)}&grant_type=client_credentials`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`Twitch token HTTP ${res.status}`);
  const data = await res.json();
  _twitchAppToken = data.access_token;
  _twitchAppTokenExpiry = Date.now() + (data.expires_in * 1000);
  return _twitchAppToken;
}

async function getViewerCount(loginName) {
  try {
    if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
      // Missing creds; skip gracefully
      return null;
    }
    const token = await getTwitchAppToken();
    const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(loginName)}`, {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });
    if (res.status === 401) { // token invalid/expired; refresh once
      _twitchAppToken = null;
      return getViewerCount(loginName);
    }
    if (!res.ok) throw new Error(`Helix streams HTTP ${res.status}`);
    const json = await res.json();
    if (json.data && json.data.length > 0) {
      return Number(json.data[0].viewer_count) || 0;
    }
    return 0; // offline
  } catch (err) {
    console.warn('getViewerCount error:', err?.message || err);
    return null; // keep previous / don’t block
  }
}

// --------------------------
// Discord (v13)
// --------------------------
const Discord = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.DIRECT_MESSAGES
  ],
  partials: ['CHANNEL'] // for DMs if ever needed
});

let trackedChannel = null;

// ---------- Activity Rotation ----------
function buildActivities(viewers) {
  const v = (typeof viewers === 'number' && viewers >= 0) ? viewers : null;

  const base = [
    { name: 'with the chat', type: 'PLAYING' }
  ];

  const streamName = v === null
    ? 'TTV: PnKllr'
    : `TTV: PnKllr | ${v} viewer${v === 1 ? '' : 's'}`;

  base.push({ name: streamName, type: 'STREAMING', url: 'https://twitch.tv/pnkllr' });
  return base;
}

async function setRandomDiscordActivity() {
  const viewers = await getViewerCount(TWITCH_CHANNEL_NAME).catch(() => null);
  const activities = buildActivities(viewers);
  const pick = activities[(Math.random() * activities.length) | 0];
  try {
    Discord.user.setActivity(pick);
  } catch (e) {
    console.warn('setActivity error:', e?.message || e);
  }
}

Discord.once('ready', async () => {
  console.log(`Discord logged in as ${Discord.user.tag}`);

  // Initial status right away
  await setRandomDiscordActivity();

  // Rotate every 5 minutes
  setInterval(setRandomDiscordActivity, 300_000);

  try {
    generalChannel = await Discord.channels.fetch(GENERAL_CHANNEL_ID);
  } catch (err) {
    console.error('Failed to fetch track generral channel:', err);
  }
  try {
    streamChannel = await Discord.channels.fetch(STREAM_CHANNEL_ID);
  } catch (err) {
    console.error('Failed to fetch track stream channel:', err);
  }
});

Discord.on('guildMemberAdd', async (member) => {
  try {
    await generalChannel.send('```diff\n+ ' + member.displayName + '```');
  } catch (err) {
    console.error('Error sending join message:', err);
  }
});

Discord.on('guildMemberRemove', async (member) => {
  try {
    await generalChannel.send('```diff\n- ' + member.displayName + '```');
  } catch (err) {
    console.error('Error sending leave message:', err);
  }
});

// --------------------------
// Twitch (tmi.js v1.8.5)
// --------------------------
const Twitch = new tmi.Client({
  options: { debug: false, messagesLogLevel: 'info' },
  connection: { reconnect: true, secure: true },
  identity: {
    username: process.env.BOT_USERNAME,
    password: process.env.BOT_OAUTH
  },
  channels: [TWITCH_CHANNEL] // must include '#'
});

function safeSay(channel, msg) {
  if (!msg) return;
  return Twitch.say(channel, String(msg)).catch(err => {
    console.warn('Twitch.say error:', err?.message || err);
  });
}

function isModOrBroadcaster(userstate) {
  const isMod = !!userstate.mod;
  const isBroadcaster = userstate.badges && userstate.badges.broadcaster === '1';
  const isOwner = TWITCH_CHANNEL_NAME.toLowerCase() === String(userstate.username || '').toLowerCase();
  return isMod || isBroadcaster || isOwner;
}

Twitch.on('connected', () => {
  try { Twitch.raw('CAP REQ :twitch.tv/tags twitch.tv/commands'); } catch {/* noop */ }
  console.log('Connected to Twitch.');
});

// Hosted
Twitch.on('hosted', (channel, username) => {
  safeSay(channel, `Really @${username}? You want to share this with other people? Really?`);
});

// Raided
Twitch.on('raided', (channel, username, viewers) => {
  safeSay(channel, `Oh hey @${username} and their ${viewers} minions o/`);
});

// Sub
Twitch.on('subscription', async (channel, username) => {
  try {
    await streamChannel.send('```asciidoc\n= New Subscriber =\n[' + username + ']\n```');
  } catch (e) { console.error(e); }
  safeSay(channel, `Oh no! @${username} is wasting money =O`);
});

// Resub
Twitch.on('resub', async (channel, username, months, message, tags) => {
  const m = Number(tags?.['msg-param-cumulative-months']) || Number(months) || 0;
  try {
    await streamChannel.send(
      '```asciidoc\n' +
      `= x${m} Month Subscriber =\n` +
      `[${username}] :: ${message || ''}\n` +
      '```'
    );
  } catch (e) { console.error(e); }
  safeSay(channel, `I guess you didn't learn the first time hey @${username}?`);
});

// Gift Sub
Twitch.on('subgift', async (channel, username, _streakMonths, recipient, _methods, tags) => {
  const totalGiftMonths = Number(tags?.['msg-param-gift-months']) || 1; // FIX: no bitwise ~
  try {
    await streamChannel.send(
      '```asciidoc\n' +
      `= ${username} Gifted a Sub =\n` +
      `[${recipient}] :: ${totalGiftMonths} Months Total\n` +
      '```'
    );
  } catch (e) { console.error(e); }
  safeSay(channel, `I'm sure they have their own money @${username}`);
});

// --------------------------
// Chat moderation & commands
// --------------------------
const COMMAND_PREFIX = '!';
const commandCooldowns = new Map();
const COOLDOWN_MS = 3000;

function onCooldown(key) {
  const now = Date.now();
  const until = commandCooldowns.get(key) || 0;
  if (until > now) return true;
  commandCooldowns.set(key, now + COOLDOWN_MS);
  return false;
}

Twitch.on('message', async (channel, userstate, message, self) => {
  if (self) return;

  const lower = (message || '').trim().toLowerCase();

  // greetings
  if (lower === 'hello') return safeSay(channel, `@${userstate['display-name']}, hey there!`);
  if (lower === 'back') return safeSay(channel, `@${userstate['display-name']}, welcome back`);
  if (lower === '^') return safeSay(channel, '^');

  // blocked words
  if (BLOCKED_WORDS.some(w => lower.includes(w))) {
    safeSay(channel, `@${userstate.username}, sorry your message contained a no no`);
    try {
      await Twitch.deletemessage(channel, userstate.id);
    } catch (err) {
      console.warn('Failed to delete message (permissions?):', err?.message || err);
    }
    return;
  }

  // commands
  if (!lower.startsWith(COMMAND_PREFIX)) return;

  const [cmd, ...args] = message.trim().split(/\s+/);
  const isPrivileged = isModOrBroadcaster(userstate);

  const commands = {
    '!commands': () =>
      `[ !discord | !website | !socials | !gt  | !tools | !lurk | !clipit | !wickd | !dead | !fall | !countreset ]`,

    '!discord': () =>
      `@${userstate['display-name']}, This is the server you're looking for ${process.env.DISCORD_INVITE}`,

    '!website': () =>
      `@${userstate['display-name']}, Don't forget to add it to your bookmarks! https://pnkllr.net`,

    '!socials': () => `Twitter: PnKllr || YouTube: PnKllr`,

    '!gt': () => `PnKllr || PnKllrTV`,

    '!tools': () => `Need some tools for your stream? Clip command, chat overlay? Check out https://tools.pnkllr.net`,

    '!lurk': () =>
      `@${userstate['display-name']}, PopCorn Thanks for Lurking! We hope you enjoy your stay PopCorn`,

    '!clipit': async () => {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(`https://tools.pnkllr.net/tools/clipit.php?channel=pnkllr&format=text`, { signal: controller.signal });
        clearTimeout(t);
        const text = await res.text();
        return `Heres the Plunkup @${userstate['display-name']} ${text}`;
      } catch (e) {
        return `@${userstate['display-name']} failed to clip right now. Try again in a moment.`;
      }
    },

    '!wickd': () =>
      `Check out our range of Wick'd Geek gear at https://wickdgeek.com.`,

    '!dead': async () => {
      if (!isPrivileged) return;
      data.dead += 1;
      await saveData();
      return `PnKllr has died ${data.dead} time(s)`;
    },

    '!fall': async () => {
      if (!isPrivileged) return;
      data.fall += 1;
      await saveData();
      return `PnKllr has fallen ${data.fall} time(s)`;
    },

    '!countreset': async () => {
      if (!isPrivileged) return;
      data.dead = 0;
      data.fall = 0;
      await saveData();
      return `Counters reset to 0!`;
    },

    '!shoutout': (args) => {
      if (!isPrivileged) return;
      if (!args.length) return 'Who do you want to shout out?';
      const target = args[0].replace('@', ''); // strip @ if they type it
      return `Go check out @${target} over at https://twitch.tv/${target}`;
    },
    '!so': (args) => commands['!shoutout'](args)
  };

  const fn = commands[cmd.toLowerCase()];
  if (!fn) return;

  const cdKey = `${cmd}|${userstate.username}`;
  if (onCooldown(cdKey)) return;

  const out = await fn(args);
  if (out) safeSay(channel, out);
});

// --------------------------
// Timers
// --------------------------
const colors = ["SpringGreen", "Blue", "Chocolate", "Red", "Coral", "Firebrick", "OrangeRed", "SeaGreen", "Green", "HotPink"];

function colorChange() {
  const color = colors[(Math.random() * colors.length) | 0];
  // send to joined channel
  safeSay(TWITCH_CHANNEL, `/color ${color}`);
}
setInterval(colorChange, 300_000); // 5 min

const timers = [
  "Enjoying stream? Then why dont you leave a follow, say something in chat or even go follow PnKllr on social media.",
  "Continue the conversation over on Discord! https://discord.gg/nth7y8TqMT",
  "Check out our Wick'd Geek Collection! https://wickdgeek.com",
  "See something dumb on stream? Use !clipit to capture it!",
  "To view a list of commands, use !commands",
  "Need tools for your stream? Head on over to https://tools.pnkllr.net"
];

function discTimer() {
  safeSay(TWITCH_CHANNEL, timers[(Math.random() * timers.length) | 0]);
}
setInterval(discTimer, 1_800_000); // 30 min

// --------------------------
// Boot & Shutdown
// --------------------------
(async function main() {
  await loadData();

  await Promise.allSettled([
    Discord.login(process.env.DISCORD_BOT_TOKEN),
    Twitch.connect()
  ]);

  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    try { await saveData(); } catch { }
    process.exit(0);
  });
})();
