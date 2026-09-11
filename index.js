// ============================================================
// Oakballs Twitch Bot
// Step 1 - Clean Foundation
//
// Requires:
//   discord.js ^13.8.0
//   tmi.js ^1.8.5
//   dotenv ^16
//   node-fetch ^2
//
// ============================================================

require('dotenv').config();

const tmi = require('tmi.js');
const { Client, Intents } = require('discord.js');
const fetch = require('node-fetch');

// ============================================================
// CONFIG
// ============================================================

const config = {
  discord: {
    token: process.env.DISCORD_BOT_TOKEN,

    channels: {
      general: process.env.GENERAL_CHANNEL_ID || '1403975109735350395',
      stream: process.env.STREAM_CHANNEL_ID || '1406543359647940700',
      twitchChat: process.env.TWITCH_CHANNEL_ID || '1415620399151976448'
    }
  },

  twitch: {
    channel: (
      process.env.CHANNEL_NAME || 'pnkllr'
    )
      .replace(/^#/, '')
      .trim()
      .toLowerCase(),

    username: process.env.BOT_USERNAME,
    oauth: process.env.BOT_OAUTH,

    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,

    url: 'https://twitch.tv/pnkllr'
  },

  discordInvite: process.env.DISCORD_INVITE || '',

  bot: {
    commandPrefix: '!',
    commandCooldownMs: 3000
  },

  moderation: {
    blockedWords: [
      'f4f',
      'follow me'
    ]
  },

  timers: {
    activity: 300_000,          // 5 minutes
    colour: 300_000,            // 5 minutes
  
    chat: {
      enabled: true,
      interval: 12 * 60_000     // 12 minutes
    },
  
    greeting: 30 * 60_000
  }
};

const TWITCH_CHANNEL = `#${config.twitch.channel}`;

// Discord channels
let generalChannel = null;
let streamChannel = null;
let chatChannel = null;

// ============================================================
// ENVIRONMENT VALIDATION
// ============================================================

function validateConfig() {
  const required = [
    ['DISCORD_BOT_TOKEN', config.discord.token],
    ['BOT_USERNAME', config.twitch.username],
    ['BOT_OAUTH', config.twitch.oauth],
    ['TWITCH_CLIENT_ID', config.twitch.clientId],
    ['TWITCH_CLIENT_SECRET', config.twitch.clientSecret]
  ];

  const missing = required
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

// ============================================================
// TWITCH HELIX API
// ============================================================

let twitchAppToken = null;
let twitchAppTokenExpiry = 0;

async function getTwitchAppToken() {
  const now = Date.now();

  if (
    twitchAppToken &&
    now < twitchAppTokenExpiry - 60_000
  ) {
    return twitchAppToken;
  }

  const url =
    'https://id.twitch.tv/oauth2/token' +
    `?client_id=${encodeURIComponent(config.twitch.clientId)}` +
    `&client_secret=${encodeURIComponent(config.twitch.clientSecret)}` +
    '&grant_type=client_credentials';

  const response = await fetch(url, {
    method: 'POST'
  });

  if (!response.ok) {
    throw new Error(
      `Twitch token HTTP ${response.status}`
    );
  }

  const tokenData = await response.json();

  twitchAppToken = tokenData.access_token;

  twitchAppTokenExpiry =
    Date.now() +
    Number(tokenData.expires_in || 0) * 1000;

  return twitchAppToken;
}

async function getViewerCount(loginName = config.twitch.channel) {
  try {
    if (
      !config.twitch.clientId ||
      !config.twitch.clientSecret
    ) {
      return null;
    }

    const token = await getTwitchAppToken();

    const response = await fetch(
      'https://api.twitch.tv/helix/streams' +
      `?user_login=${encodeURIComponent(loginName)}`,
      {
        headers: {
          'Client-ID': config.twitch.clientId,
          'Authorization': `Bearer ${token}`
        }
      }
    );

    // Token expired or invalid.
    // Clear it and try exactly once.
    if (response.status === 401) {
      twitchAppToken = null;
      twitchAppTokenExpiry = 0;

      const freshToken = await getTwitchAppToken();

      const retryResponse = await fetch(
        'https://api.twitch.tv/helix/streams' +
        `?user_login=${encodeURIComponent(loginName)}`,
        {
          headers: {
            'Client-ID': config.twitch.clientId,
            'Authorization': `Bearer ${freshToken}`
          }
        }
      );

      if (!retryResponse.ok) {
        throw new Error(
          `Twitch streams retry HTTP ${retryResponse.status}`
        );
      }

      const retryData = await retryResponse.json();

      if (
        retryData.data &&
        retryData.data.length > 0
      ) {
        return Number(
          retryData.data[0].viewer_count
        ) || 0;
      }

      return 0;
    }

    if (!response.ok) {
      throw new Error(
        `Twitch streams HTTP ${response.status}`
      );
    }

    const json = await response.json();

    if (
      json.data &&
      json.data.length > 0
    ) {
      return Number(
        json.data[0].viewer_count
      ) || 0;
    }

    // Stream is offline.
    return 0;

  } catch (error) {
    console.warn(
      '[Twitch API] getViewerCount:',
      error.message
    );

    // null means the API failed.
    // 0 means the stream is actually offline.
    return null;
  }
}

// ============================================================
// DISCORD
// ============================================================

const Discord = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.DIRECT_MESSAGES
  ],

  partials: [
    'CHANNEL'
  ]
});

// ------------------------------------------------------------
// Discord Activity
// ------------------------------------------------------------

async function setDiscordActivity() {
  try {
    const viewers = await getViewerCount();

    let activity;

    if (viewers === null) {
      activity = {
        name: 'TTV: PnKllr',
        type: 'STREAMING',
        url: config.twitch.url
      };
    } else if (viewers < 1) {
      activity = {
        name: 'waiting for viewers...',
        type: 'WATCHING'
      };
    } else {
      activity = {
        name:
          `TTV: PnKllr | ${viewers} viewer` +
          `${viewers === 1 ? '' : 's'}`,

        type: 'STREAMING',
        url: config.twitch.url
      };
    }

    Discord.user.setActivity(activity);

  } catch (error) {
    console.warn(
      '[Discord] Activity update failed:',
      error.message
    );
  }
}

// ------------------------------------------------------------
// Discord Ready
// ------------------------------------------------------------

Discord.once('ready', async () => {
  console.log(
    `[Discord] Logged in as ${Discord.user.tag}`
  );

  await loadDiscordChannels();

  await setDiscordActivity();

  activityInterval = setInterval(
    setDiscordActivity,
    config.timers.activity
  );
});

// ------------------------------------------------------------
// Discord Channel Loading
// ------------------------------------------------------------

async function loadDiscordChannels() {
  try {
    generalChannel =
      await Discord.channels.fetch(
        config.discord.channels.general
      );

    console.log('[Discord] General channel loaded.');
  } catch (error) {
    console.error(
      '[Discord] Failed to load general channel:',
      error.message
    );
  }

  try {
    streamChannel =
      await Discord.channels.fetch(
        config.discord.channels.stream
      );

    console.log('[Discord] Stream channel loaded.');
  } catch (error) {
    console.error(
      '[Discord] Failed to load stream channel:',
      error.message
    );
  }

  try {
    chatChannel =
      await Discord.channels.fetch(
        config.discord.channels.twitchChat
      );

    console.log('[Discord] Twitch chat channel loaded.');
  } catch (error) {
    console.error(
      '[Discord] Failed to load Twitch chat channel:',
      error.message
    );
  }
}

// ------------------------------------------------------------
// Discord Join
// ------------------------------------------------------------

Discord.on(
  'guildMemberAdd',
  async member => {
    if (!generalChannel) {
      return;
    }

    try {
      await generalChannel.send(
        `\`\`\`diff\n+ ${member.displayName}\`\`\``
      );
    } catch (error) {
      console.error(
        '[Discord] Join message failed:',
        error.message
      );
    }
  }
);

// ------------------------------------------------------------
// Discord Leave
// ------------------------------------------------------------

Discord.on(
  'guildMemberRemove',
  async member => {
    if (!generalChannel) {
      return;
    }

    try {
      await generalChannel.send(
        `\`\`\`diff\n- ${member.displayName}\`\`\``
      );
    } catch (error) {
      console.error(
        '[Discord] Leave message failed:',
        error.message
      );
    }
  }
);

// ============================================================
// TWITCH
// ============================================================

const Twitch = new tmi.Client({
  options: {
    debug: false,
    messagesLogLevel: 'info'
  },

  connection: {
    reconnect: true,
    secure: true
  },

  identity: {
    username: config.twitch.username,
    password: config.twitch.oauth
  },

  channels: [
    TWITCH_CHANNEL
  ]
});

// ------------------------------------------------------------
// Twitch Helpers
// ------------------------------------------------------------

function safeSay(channel, message) {
  if (!message) {
    return Promise.resolve();
  }

  return Twitch
    .say(
      channel || TWITCH_CHANNEL,
      String(message)
    )
    .catch(error => {
      console.warn(
        '[Twitch] Failed to send message:',
        error.message
      );
    });
}

function isModOrBroadcaster(userstate) {
  const isMod = Boolean(userstate?.mod);

  const isBroadcaster =
    userstate?.badges?.broadcaster === '1';

  const isOwner =
    config.twitch.channel ===
    String(userstate?.username || '')
      .toLowerCase();

  return (
    isMod ||
    isBroadcaster ||
    isOwner
  );
}

// ------------------------------------------------------------
// Twitch Connection
// ------------------------------------------------------------

Twitch.on(
  'connected',
  (address, port) => {
    try {
      Twitch.raw(
        'CAP REQ :twitch.tv/tags twitch.tv/commands'
      );
    } catch {
      // Ignore CAP errors.
    }

    console.log(
      `[Twitch] Connected to ${address}:${port}`
    );
  }
);

Twitch.on(
  'disconnected',
  reason => {
    console.warn(
      `[Twitch] Disconnected: ${reason || 'unknown reason'}`
    );
  }
);

Twitch.on(
  'reconnect',
  () => {
    console.log('[Twitch] Reconnecting...');
  }
);

// ============================================================
// TWITCH EVENTS
// ============================================================

// ------------------------------------------------------------
// Raid
// ------------------------------------------------------------

Twitch.on(
  'raided',
  (channel, username, viewers) => {
    safeSay(
      channel,
      `⚡ RAID ALERT! ${username} and ${viewers} raiders are storming in! Welcome! 🚀`
    );

    safeSay(
      channel,
      `/shoutout ${username}`
    );

    safeSay(
      channel,
      `!so ${username}`
    );
  }
);

// ------------------------------------------------------------
// New Subscription
// ------------------------------------------------------------

Twitch.on(
  'subscription',
  async (
    channel,
    username,
    methods
  ) => {
    const isPrime =
      methods?.prime ||
      methods?.plan === 'Prime';

    const embedMsg =
      isPrime
        ? `= New Prime Subscriber =\n[${username}]`
        : `= New Subscriber =\n[${username}]`;

    if (streamChannel) {
      try {
        await streamChannel.send(
          '```asciidoc\n' +
          embedMsg +
          '\n```'
        );
      } catch (error) {
        console.error(
          '[Discord] Subscription message failed:',
          error.message
        );
      }
    }

    const chatMsg =
      isPrime
        ? `🎉 Thank you ${username} for subscribing with Prime! Enjoy the perks 🙌`
        : `💜 Thank you ${username} for subscribing! Welcome aboard 🚀`;

    safeSay(channel, chatMsg);
  }
);

// ------------------------------------------------------------
// Resub
// ------------------------------------------------------------

Twitch.on(
  'resub',
  async (
    channel,
    username,
    months,
    message,
    tags,
    methods
  ) => {
    const totalMonths =
      Number(
        tags?.['msg-param-cumulative-months']
      ) ||
      Number(months) ||
      0;

    const isPrime =
      methods?.prime ||
      methods?.plan === 'Prime';

    const body =
      `= x${totalMonths} Month ` +
      `${isPrime ? 'Prime ' : ''}` +
      `Subscriber =\n` +
      `[${username}] :: ${message || ''}`;

    if (streamChannel) {
      try {
        await streamChannel.send(
          '```asciidoc\n' +
          body +
          '\n```'
        );
      } catch (error) {
        console.error(
          '[Discord] Resub message failed:',
          error.message
        );
      }
    }

    const chatMsg =
      isPrime
        ? `🔥 ${username} has resubscribed with Prime for ${totalMonths} months! Thank you 🙏`
        : `💎 ${username} resubbed for ${totalMonths} months! Absolute legend 💜`;

    safeSay(channel, chatMsg);
  }
);

// ------------------------------------------------------------
// Gift Sub
// ------------------------------------------------------------

Twitch.on(
  'subgift',
  async (
    channel,
    username,
    streakMonths,
    recipient,
    methods,
    tags
  ) => {
    const totalGiftMonths =
      Number(
        tags?.['msg-param-months']
      ) || 1;

    const totalGiftsByUser =
      Number(
        tags?.['msg-param-sender-count']
      ) || 0;

    const embed =
      `= ${username} Gifted a Sub =\n` +
      `[${recipient}] :: ${totalGiftMonths} months total`;

    if (streamChannel) {
      try {
        await streamChannel.send(
          '```asciidoc\n' +
          embed +
          '\n```'
        );
      } catch (error) {
        console.error(
          '[Discord] Gift sub message failed:',
          error.message
        );
      }
    }

    safeSay(
      channel,
      `🎁 ${username} just gifted a sub to ${recipient}! ` +
      `(${totalGiftMonths} month${totalGiftMonths > 1 ? 's' : ''} total - ` +
      `${totalGiftsByUser} gifts overall) 💜`
    );
  }
);

// ------------------------------------------------------------
// Gift Bomb
// ------------------------------------------------------------

Twitch.on(
  'submysterygift',
  async (
    channel,
    username,
    giftSubCount,
    methods,
    tags
  ) => {
    const totalGiftsByUser =
      Number(
        tags?.['msg-param-sender-count']
      ) || 0;

    const embed =
      `= ${username} Dropped a Sub Bomb =\n` +
      `Count :: ${giftSubCount} subs`;

    if (streamChannel) {
      try {
        await streamChannel.send(
          '```asciidoc\n' +
          embed +
          '\n```'
        );
      } catch (error) {
        console.error(
          '[Discord] Sub bomb message failed:',
          error.message
        );
      }
    }

    safeSay(
      channel,
      `💣 ${username} just gifted ${giftSubCount} subs! ` +
      `Absolute legend 🙌 ` +
      `(Total gifts: ${totalGiftsByUser})`
    );
  }
);

// ============================================================
// COMMANDS
// ============================================================

const commandCooldowns = new Map();

function onCooldown(key) {
  const now = Date.now();

  const cooldownUntil =
    commandCooldowns.get(key) || 0;

  if (cooldownUntil > now) {
    return true;
  }

  commandCooldowns.set(
    key,
    now + config.bot.commandCooldownMs
  );

  return false;
}

// ------------------------------------------------------------
// Command Definitions
// ------------------------------------------------------------

const commands = {

  '!commands': () =>
    '[ !discord | !website | !socials | !gt | !tools | !lurk | !clipit | !wickd | !so ]',

  '!discord': ({ userstate }) =>
    `@${userstate['display-name']}, This is the server you're looking for ${config.discordInvite}`,

  '!website': ({ userstate }) =>
    `@${userstate['display-name']}, Don't forget to add it to your bookmarks! https://pnkllr.net`,

  '!socials': () =>
    'Twitter: PnKllr || Tiktok: PnKllrTTV',

  '!gt': () =>
    'PnKllr || PnKllrTV',

  '!tools': () =>
    'Need some tools for your stream? Clip command, chat overlay? Check out https://tools.pnkllr.net',

  '!lurk': ({ userstate }) =>
    `@${userstate['display-name']}, PopCorn Thanks for Lurking! We hope you enjoy your stay PopCorn`,

  '!clipit': async ({ userstate }) => {
    try {
      const controller =
        new AbortController();

      const timeout =
        setTimeout(
          () => controller.abort(),
          10_000
        );

      let response;

      try {
        response = await fetch(
          `https://tools.pnkllr.net/tools/clipit.php?channel=${encodeURIComponent(config.twitch.channel)}&format=text`,
          {
            signal: controller.signal
          }
        );
      } finally {
        clearTimeout(timeout);
      }

      const text =
        await response.text();

      if (
        !response.ok ||
        text.toLowerCase().includes('error')
      ) {
        return (
          `@${userstate['display-name']} failed to clip right now. ` +
          'Try again in a moment.'
        );
      }

      await new Promise(
        resolve => setTimeout(resolve, 5000)
      );

      return (
        `Heres the Plunkup @${userstate['display-name']} ${text}`
      );

    } catch {
      return (
        `@${userstate['display-name']} failed to clip right now. ` +
        'Try again in a moment.'
      );
    }
  },

  '!wickd': () =>
    "Check out our range of Wick'd Geek gear at https://wickdgeek.com.",

  '!shoutout': ({ args, privileged }) => {
    if (!privileged) {
      return null;
    }

    if (!args.length) {
      return 'Who do you want to shout out?';
    }

    const target =
      String(args[0])
        .replace(/^@/, '')
        .toLowerCase();

    if (!/^[a-z0-9_]{1,25}$/.test(target)) {
      return 'That does not look like a valid Twitch username.';
    }

    return (
      `Go check out @${target} over at ` +
      `https://twitch.tv/${target}`
    );
  }

};

// Alias
commands['!so'] = commands['!shoutout'];

// ============================================================
// CHAT
// ============================================================

Twitch.on(
  'message',
  async (
    channel,
    userstate,
    message,
    self
  ) => {

    // --------------------------------------------------------
    // Ignore our own messages
    // --------------------------------------------------------

    if (self) {
      return;
    }

    // --------------------------------------------------------
    // Bits
    // --------------------------------------------------------

    const bits =
      Number.parseInt(
        userstate.bits || 0,
        10
      );

    if (bits > 0) {
      safeSay(
        channel,
        `🎉 ${userstate['display-name']} just cheered with ${bits} bits! Thank you 💜`
      );
    }

    // --------------------------------------------------------
    // Twitch -> Discord Chat Relay
    // --------------------------------------------------------

    if (chatChannel) {
      try {
        await chatChannel.send(
          '```asciidoc\n' +
          `[${userstate['display-name']}] :: ${message}\n` +
          '```'
        );
      } catch (error) {
        console.error(
          '[Discord] Chat relay failed:',
          error.message
        );
      }
    }

    // --------------------------------------------------------
    // Personal Greeting
    // --------------------------------------------------------

    PersonalGreet(
      Twitch,
      channel,
      userstate?.username,
      'message'
    );

    // --------------------------------------------------------
    // Normalise message
    // --------------------------------------------------------

    const lower =
      String(message || '')
        .trim()
        .toLowerCase();

    // --------------------------------------------------------
    // Simple greetings
    // --------------------------------------------------------

    if (lower === 'hello') {
      return safeSay(
        channel,
        `@${userstate['display-name']}, hey there!`
      );
    }

    if (lower === 'back') {
      return safeSay(
        channel,
        `@${userstate['display-name']}, welcome back`
      );
    }

    if (lower === '^') {
      return safeSay(channel, '^');
    }

    // --------------------------------------------------------
    // Moderation
    // --------------------------------------------------------

    if (
      config.moderation.blockedWords.some(
        word => lower.includes(word)
      )
    ) {
      safeSay(
        channel,
        `@${userstate.username}, sorry your message contained a no no`
      );

      try {
        await Twitch.deletemessage(
          channel,
          userstate.id
        );
      } catch (error) {
        console.warn(
          '[Twitch] Failed to delete message:',
          error.message
        );
      }

      return;
    }

    // --------------------------------------------------------
    // Commands
    // --------------------------------------------------------

    if (
      !lower.startsWith(
        config.bot.commandPrefix
      )
    ) {
      return;
    }

    const parts =
      String(message)
        .trim()
        .split(/\s+/);

    const commandName =
      parts.shift().toLowerCase();

    const args = parts;

    const command =
      commands[commandName];

    if (!command) {
      return;
    }

    const privileged =
      isModOrBroadcaster(userstate);

    const cooldownKey =
      `${commandName}|${userstate.username}`;

    if (onCooldown(cooldownKey)) {
      return;
    }

    try {
      const output =
        await command({
          channel,
          userstate,
          args,
          privileged
        });

      if (output) {
        safeSay(
          channel,
          output
        );
      }

    } catch (error) {
      console.error(
        `[Command] ${commandName} failed:`,
        error
      );

      safeSay(
        channel,
        `@${userstate['display-name']}, something went wrong with that command.`
      );
    }
  }
);

// ============================================================
// PERSONALIZED GREETINGS
// ============================================================

function normUser(username) {
  return String(username || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

const RAW_SPECIAL_USERS = {

  therottenpeach: [
    "Alright everyone, behave... mum's here. {user}",
    "Keeping us in line like always - good to have you back {user}.",
    "The group feels calmer when you walk in {user}.",
    "Look who's arrived to make sure we're behaving ourselves. Welcome back {user}!",
    "Mum has entered the chat. Everyone act normal! {user}",
    "Uh oh... the responsible one is here. Welcome back {user}!",
    "Everyone behave yourselves, {user} is watching 👀",
    "Welcome back {user}! Now we might actually have some adult supervision.",
    "There she is! The unofficial mum of the chat has arrived {user} ❤️",
    "Good to see you again {user}. You keeping these idiots under control?"
  ],

  bigstona: [
    "Brad's here - controller locked and loaded. {user}",
    "Wouldn't be a proper stream without the gaming crew checking in. {user}",
    "Alright, who gave Brad another energy drink? {user}",
    "Look who finally showed up! Welcome back {user}!",
    "Brad has entered the chat - somebody hide the spare controllers. {user}",
    "The gaming department has arrived. Welcome back {user}!",
    "Everyone make some room, Brad's here! {user}",
    "There he is! Ready to cause some gaming-related trouble, {user}?",
    "Welcome back {user} - the controller is waiting for you.",
    "Brad has arrived. Now things are getting serious... or considerably less serious 😂"
  ],

  andeey: [
    "Warning: sugar spike incoming. It's another stream with {user}!",
    "Thanks for rolling in, you always bring that extra bit of energy {user}.",
    "Another dose of chaos, courtesy of {user}.",
    "Here comes the energy! Welcome back {user}!",
    "Everybody brace yourselves - {user} has arrived!",
    "The chaos levels just increased. Welcome back {user}!",
    "Look who's here to turn the energy level up to 11 - {user}!",
    "We were getting a little too calm... thankfully {user} is here.",
    "Welcome back {user}! The stream just got a little louder 😂",
    "And just like that, the energy has arrived. Good to see you {user}!"
  ],

  depemy: [
    "The veteran just clocked in - everyone else take notes. {user}",
    "Day-ones like you keep this whole thing real. Welcome back, mate. {user}",
    "One of the OGs has arrived - respect {user}!",
    "Look who's back! An absolute veteran of the community - {user}.",
    "The OG has entered the chat. Welcome back {user}!",
    "Years of experience have just walked through the door. Good to see you {user}!",
    "Everybody pay attention - one of the originals is here. {user}",
    "Welcome back, legend. The place wouldn't be the same without you {user}.",
    "The veteran returns! Good to have you here again {user}.",
    "One of the founding members of the chaos has arrived. Welcome back {user}!"
  ],

  yummynoodle: [
    "Hide your pets, {user} is here again.",
    "Good to see you, always bringing the laughs we need {user}.",
    "Uh oh, who let {user} back in the kitchen?",
    "The noodle has returned! Welcome back {user} 🍜",
    "Everybody hide the snacks - {user} is here.",
    "Look who's back in the kitchen! Good to see you {user}.",
    "The noodles are officially in the building. Welcome back {user}!",
    "Uh oh... something tells me the kitchen isn't safe anymore. {user} is here.",
    "Welcome back {user}! Please keep your hands away from the snacks.",
    "The chef has arrived. Nobody knows what they're cooking, but we're concerned 😂"
  ],

  tegancarmody: [
    "Tegan's here! What terrifying game are we getting into tonight? 👻",
    "Welcome back {user}! Ready to voluntarily scare yourself again? 😂",
    "The horror gamer has arrived. Things are about to get scary 👀",
    "Look who's clocked off and joined us! Welcome back {user}!",
    "Welcome back {user}! No healthcare emergencies in chat tonight please 😂",
    "Tegan has arrived! Everyone behave, we've got healthcare staff in the building.",
    "Tegan has connected successfully. Human verification still pending... 🤖",
    "Welcome back {user}! The bot appears to be functioning normally today.",
    "SYSTEM UPDATE: Tegan has entered the chat. No further information available. 🤖",
    "Look who's here! Welcome back {user} 💜",
    "Tegan has arrived! Good to see you {user}!",
    "Welcome back {user}! Glad you could join us again 👋"
  ],

};

const SPECIAL_USERS =
  new Map(
    Object.entries(
      RAW_SPECIAL_USERS
    ).map(
      ([username, lines]) => [
        normUser(username),
        lines
      ]
    )
  );

const GREET_COOLDOWN_MS =
  config.timers.greeting;

const JOIN_DELAY_MS = 4000;

const lastGreetAt = new Map();
const greetedThisSession = new Set();

function pickRandom(array) {
  return array[
    Math.floor(
      Math.random() * array.length
    )
  ];
}

function canGreet(username) {
  const now = Date.now();

  const last =
    lastGreetAt.get(username) || 0;

  return (
    now - last >=
    GREET_COOLDOWN_MS
  );
}

function markGreeted(username) {
  lastGreetAt.set(
    username,
    Date.now()
  );

  greetedThisSession.add(
    username
  );
}

function formatLine(
  line,
  username
) {
  return String(line)
    .replaceAll(
      '{user}',
      username
    );
}

function PersonalGreet(
  client,
  channel,
  username,
  reason = 'join'
) {
  const user =
    normUser(username);

  if (!user) {
    return;
  }

  // Ignore the bot itself.
  if (
    client?.getUsername &&
    normUser(
      client.getUsername()
    ) === user
  ) {
    return;
  }

  const lines =
    SPECIAL_USERS.get(user);

  if (
    !lines ||
    lines.length === 0
  ) {
    return;
  }

  if (reason === 'message') {

    if (
      greetedThisSession.has(user)
    ) {
      return;
    }

    if (!canGreet(user)) {
      return;
    }

    const line =
      pickRandom(lines);

    markGreeted(user);

    return safeSay(
      channel,
      formatLine(
        line,
        `@${user}`
      )
    );
  }

  if (reason === 'join') {

    if (
      greetedThisSession.has(user)
    ) {
      return;
    }

    if (!canGreet(user)) {
      return;
    }

    setTimeout(() => {

      if (
        greetedThisSession.has(user)
      ) {
        return;
      }

      if (!canGreet(user)) {
        return;
      }

      const line =
        pickRandom(lines);

      markGreeted(user);

      safeSay(
        channel,
        formatLine(
          line,
          `@${user}`
        )
      );

    }, JOIN_DELAY_MS);
  }
}

// ============================================================
// TWITCH JOIN EVENT
// ============================================================

Twitch.on(
  'join',
  (channel, username, self) => {
    if (self) {
      return;
    }

    // Currently disabled.
    // We greet on the user's first message instead.
  }
);

// ============================================================
// AUTOMATIC COLOUR
// ============================================================

const colours = [
  'SpringGreen',
  'Blue',
  'Chocolate',
  'Red',
  'Coral',
  'Firebrick',
  'OrangeRed',
  'SeaGreen',
  'Green',
  'HotPink'
];

function colorChange() {
  const colour =
    pickRandom(colours);

  safeSay(
    TWITCH_CHANNEL,
    `/color ${colour}`
  );
}

// ============================================================
// AUTOMATIC CHAT TIMERS
// ============================================================

const timerPools = {

  engagement: {
    weight: 5,

    messages: [
      'Enjoying the stream? Drop a follow and come hang out with us again 💜',
      'Lurkers are always welcome here 👀 But if you feel like chatting, say hello!',
      'Enjoying the vibes? Say something in chat - we dont bite... usually 😈',
      'Got a question? Ask away! Chat is always open 💬',
      'If youre having a good time, sharing the stream with a friend helps more than you think 💜',
      'Welcome to the stream! Grab a drink, get comfortable and enjoy the chaos 🍻',
      'If youre new here, welcome! Feel free to say hello and introduce yourself 👋',
      'Chat is always better with you in it - dont be afraid to jump into the conversation 💬',
      'Having a good time? A follow is free and helps support the stream ❤️',
      'Enjoying the chaos? Stick around and see what happens next 👀',
      'Whether youre chatting or lurking, thanks for hanging out with us today 💜',
      'If youre enjoying the stream, let me know what youre watching from chat!',
      'Found the stream by accident? You might as well stick around now 😈',
      'Make yourself comfortable - youre part of the community while youre here 💜',
      'Dont just watch the chaos - become part of it! Jump into chat 👀',
      'If youve been lurking for a while, this is your official invitation to say hello 👋',
      'Every viewer helps keep the stream going - thanks for being here 💜',
      'Enjoying the stream? Tell chat what youre up to today!',
      'The more people talking in chat, the more interesting things get. So speak up! 💬',
      'Thanks for spending some of your time with us today. It genuinely means a lot 💜'
    ]
  },

  commands: {
    weight: 3,

    messages: [
      'Need to know what the bot can do? Use !commands',
      'See something worth keeping forever? Use !clipit to grab a clip!',
      'Mods can give channels a shoutout with !so <name>',
      'Want to know what commands are available? Try !commands',
      'Want to share the stream? Use !discord to grab the community Discord!',
      'Need a clip? !clipit has you covered!',
      'Curious what commands are available? Hit !commands and have a look 👀',
      'Want to check out the stream tools? Try !tools',
      'Found another streamer you want to support? Mods can use !so <name>',
      'Want to lurk? Use !lurk and let us know youre still around 👀',
      'Looking for the full list of bot commands? !commands is your friend.',
      'See something hilarious? Dont forget to use !clipit before the moment is gone!'
    ]
  },

  socials: {
    weight: 2,

    messages: [
      'Come hang out with the community on Discord! https://discord.gg/nth7y8TqMT',
      'Want more PnKllr outside the stream? Follow along on Twitter/X: https://x.com/pnkllr',
      'Keep up with the chaos outside Twitch - Twitter/X: https://x.com/pnkllr',
      'Join the Discord and hang out with the community! https://discord.gg/nth7y8TqMT',
      'Want to see more of what happens outside the stream? Follow me on TikTok! https://tiktok.com/@a.jmmw',
      'TikTok has even more random PnKllr nonsense - come follow along! https://tiktok.com/@a.jmmw',
      'Follow me on TikTok for more clips, chaos and random stuff! https://tiktok.com/@a.jmmw',
      'Keep up with me outside Twitch - TikTok: https://tiktok.com/@a.jmmw',
      'The community doesnt stop when the stream ends - join the Discord! https://discord.gg/nth7y8TqMT',
      'Want to keep hanging out after stream? Join the Discord! https://discord.gg/nth7y8TqMT'
    ]
  },

  promo: {
    weight: 1,

    messages: [
      "Check out the Wick'd Geek Collection! https://wickdgeek.com",
      'Looking for stream tools? Check out https://tools.pnkllr.net',
      'Need some useful tools for your own stream? Have a look at https://tools.pnkllr.net',
      'Want to support the stream? Check out the Wick\'d Geek Collection! https://wickdgeek.com',
      'Looking for something different? Check out the Wick\'d Geek gear! https://wickdgeek.com'
    ]
  },

  fun: {
    weight: 4,

    messages: [
      'Hydration check 💧 Grab a drink!',
      'Stretch check 🧘‍♂️ Weve been sitting here long enough.',
      'Remember - clips are forever. Embarrass me responsibly 😎',
      'Chat messages power the stream. Silence drains my energy bar ⚡',
      'If the stream suddenly gets quiet, Im assuming everyone fell asleep 👀',
      'Everyone take a drink - yes, this includes the lurkers 💧',
      'Blink twice if youre still awake 👀',
      'Chat, on a scale of 1 to chaos, how are we doing tonight?',
      'I have absolutely no idea whats happening anymore, but Im glad youre here 😂',
      'If something stupid happens, nobody saw anything. Unless someone clips it 👀',
      'Current stream status: somehow still under control... probably.',
      'Reminder: we are here for a good time, not a professional production 😎',
      'Chat check - whos still awake?',
      'If youve been here long enough, youre basically part of the furniture now.',
      'Things were going suspiciously well... so naturally something is about to go wrong.',
      'At this point Im convinced chat is secretly running the stream.',
      'Somewhere out there, someone is watching this and thinking "what the hell did I find?" 😂',
      'The plan was simple. Unfortunately, we started streaming.',
      'Professional streamer by day, questionable decision maker by night.',
      'If chaos was a Twitch category, wed be top of the directory.'
    ]
  },

  community: {
    weight: 3,

    messages: [
      'Big welcome to everyone hanging out tonight! 💜',
      'Shoutout to the lurkers, chatters and everyone just chilling in the background 👋',
      'This community is only as good as the people in it - thanks for being here 💜',
      'Make sure you say hello to the people around you in chat!',
      'New here? Stick around and get to know the community 👀',
      'Regulars, lurkers and first-time viewers - youre all welcome here 💜',
      'Chat is basically a bunch of strangers who decided to hang out together. I like it 😂',
      'Thanks for making this little corner of Twitch a fun place to hang out.',
      'If youre new, dont worry about fitting in - just jump into the conversation!',
      'Remember to be good to each other. Were all here to have a good time 💜'
    ]
  },

  pokemon: {
    weight: 2,

    messages: [
      'Need your Pokemon fix? Check out the Pokedex over at https://profoak.net',
      'Looking up a Pokemon? Professor Oak has you covered! https://profoak.net',
      'Want to explore the Pokemon database? Head over to https://profoak.net',
      'Your next Pokemon rabbit hole starts here 👀 https://profoak.net',
      'Need Pokemon information? Check out the database at https://profoak.net',
      'Got a Pokemon question? The database might have the answer! https://profoak.net',
      'For all things Pokemon, check out Professor Oak: https://profoak.net'
    ]
  }

};

// ------------------------------------------------------------
// Timer State
// ------------------------------------------------------------

let lastTimerCategory = null;
let lastTimerMessage = null;
let timerHistory = [];

const MAX_TIMER_HISTORY = 5;

// ------------------------------------------------------------
// Weighted Category Selection
// ------------------------------------------------------------

function getWeightedCategory() {

  const categories =
    Object.entries(timerPools)
      .filter(
        ([, pool]) =>
          pool &&
          Array.isArray(pool.messages) &&
          pool.messages.length > 0 &&
          Number(pool.weight) > 0
      );

  if (!categories.length) {
    return null;
  }

  // Avoid repeating the same category twice in a row.
  const available =
    categories.filter(
      ([name]) =>
        name !== lastTimerCategory
    );

  const pool =
    available.length
      ? available
      : categories;

  const totalWeight =
    pool.reduce(
      (total, [, category]) =>
        total + Number(category.weight),
      0
    );

  let random =
    Math.random() * totalWeight;

  for (const [name, category] of pool) {

    random -= Number(category.weight);

    if (random <= 0) {
      return name;
    }
  }

  return pool[pool.length - 1][0];
}

// ------------------------------------------------------------
// Message Selection
// ------------------------------------------------------------

function getTimerMessage(categoryName) {

  const category =
    timerPools[categoryName];

  if (
    !category ||
    !Array.isArray(category.messages) ||
    !category.messages.length
  ) {
    return null;
  }

  // Avoid recently used messages.
  const available =
    category.messages.filter(
      message =>
        !timerHistory.includes(message)
    );

  const pool =
    available.length
      ? available
      : category.messages;

  let message =
    pickRandom(pool);

  // Extra protection against immediate repetition.
  if (
    pool.length > 1 &&
    message === lastTimerMessage
  ) {
    const alternatives =
      pool.filter(
        item =>
          item !== lastTimerMessage
      );

    message =
      pickRandom(alternatives);
  }

  return message;
}

// ------------------------------------------------------------
// Get Next Timer Message
// ------------------------------------------------------------

function getNextTimerMessage() {

  const category =
    getWeightedCategory();

  if (!category) {
    return null;
  }

  const message =
    getTimerMessage(category);

  if (!message) {
    return null;
  }

  lastTimerCategory =
    category;

  lastTimerMessage =
    message;

  timerHistory.push(message);

  if (
    timerHistory.length >
    MAX_TIMER_HISTORY
  ) {
    timerHistory.shift();
  }

  return {
    category,
    message
  };
}

// ------------------------------------------------------------
// Automatic Chat Timer
// ------------------------------------------------------------

async function discTimer() {

  try {

    const viewers =
      await getViewerCount();

    // Twitch API unavailable.
    if (viewers === null) {

      console.log(
        '[Timer] Skipped - Twitch API unavailable.'
      );

      return;
    }

    // Stream offline.
    if (viewers < 1) {

      console.log(
        '[Timer] Skipped - stream offline.'
      );

      return;
    }

    const timer =
      getNextTimerMessage();

    if (!timer) {

      console.log(
        '[Timer] Skipped - no timer messages available.'
      );

      return;
    }

    await safeSay(
      TWITCH_CHANNEL,
      timer.message
    );

    console.log(
      `[Timer] [${timer.category}] ${timer.message}`
    );

  } catch (error) {

    console.error(
      '[Timer] Failed:',
      error.message
    );

  }
}

// ============================================================
// INTERVALS
// ============================================================

let activityInterval = null;
let colourInterval = null;
let chatTimerInterval = null;

// ============================================================
// STARTUP
// ============================================================

async function start() {
  console.log('');
  console.log('================================');
  console.log('       Oakballs Twitch Bot');
  console.log('================================');
  console.log('');

  validateConfig();

  console.log(
    `[Config] Twitch channel: ${TWITCH_CHANNEL}`
  );

  const results =
    await Promise.allSettled([
      Discord.login(
        config.discord.token
      ),

      Twitch.connect()
    ]);

  const discordResult =
    results[0];

  const twitchResult =
    results[1];

  if (
    discordResult.status === 'fulfilled'
  ) {
    console.log(
      '[Startup] Discord connection successful.'
    );
  } else {
    console.error(
      '[Startup] Discord connection failed:',
      discordResult.reason
    );
  }

  if (
    twitchResult.status === 'fulfilled'
  ) {
    console.log(
      '[Startup] Twitch connection successful.'
    );
  } else {
    console.error(
      '[Startup] Twitch connection failed:',
      twitchResult.reason
    );
  }

  colourInterval =
    setInterval(
      colorChange,
      config.timers.colour
    );

  if (config.timers.chat.enabled) {

    chatTimerInterval =
      setInterval(
        discTimer,
        config.timers.chat.interval
      );
  
    console.log(
      `[Timer] Chat timers enabled - every ${config.timers.chat.interval / 60_000} minutes.`
    );
  
  } else {
  
    console.log(
      '[Timer] Chat timers disabled.'
    );
  }
  
    console.log('');
    console.log(
      '[Startup] Bot initialisation complete.'
    );
    console.log('');
}

// ============================================================
// SHUTDOWN
// ============================================================

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log('');
  console.log(
    `[Shutdown] Received ${signal}.`
  );

  if (activityInterval) {
    clearInterval(activityInterval);
  }

  if (colourInterval) {
    clearInterval(colourInterval);
  }

  if (chatTimerInterval) {
    clearInterval(chatTimerInterval);
  }

  try {
    await Twitch.disconnect();

    console.log(
      '[Shutdown] Twitch disconnected.'
    );
  } catch (error) {
    console.warn(
      '[Shutdown] Twitch disconnect failed:',
      error.message
    );
  }

  try {
    Discord.destroy();

    console.log(
      '[Shutdown] Discord disconnected.'
    );
  } catch (error) {
    console.warn(
      '[Shutdown] Discord disconnect failed:',
      error.message
    );
  }

  console.log(
    '[Shutdown] Goodbye.'
  );

  process.exit(0);
}

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

// ============================================================
// START
// ============================================================

start().catch(error => {
  console.error('');
  console.error(
    '[FATAL] Bot failed to start:'
  );
  console.error(error);
  console.error('');

  process.exit(1);
});
