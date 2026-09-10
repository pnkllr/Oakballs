````js
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
    activity: 300_000,       // 5 minutes
    colour: 300_000,        // 5 minutes
    chat: 900_000,          // 15 minutes
    greeting: 30 * 60_000   // 30 minutes
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
      `/so ${username}`
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
    "The group feels calmer when you walk in {user}"
  ],

  bigstona: [
    "Brad's here - controller locked and loaded. {user}",
    "Wouldn't be a proper stream without the gaming crew checking in. {user}",
    "Alright, who gave Brad another energy drink? {user}"
  ],

  andeey: [
    "Warning: sugar spike incoming. It's another stream with {user}!",
    "Thanks for rolling in, you always bring that extra bit of energy {user}.",
    "Another dose of chaos, courtesy of {user}."
  ],

  depemy: [
    "The veteran just clocked in - everyone else take notes. {user}",
    "Day-ones like you keep this whole thing real. Welcome back, mate. {user}",
    "One of the OGs has arrived - respect {user}!"
  ],

  yummynoodle: [
    "Hide your pets, {user} is here again.",
    "Good to see you, always bringing the laughs we need {user}.",
    "Uh oh, who let {user} back in the kitchen?"
  ]

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

  engagement: [
    'Enjoying stream? Why not leave a follow or say something in chat 💬',
    'Your support keeps the stream alive 💜 Even just hanging out means a lot!',
    'If you’re enjoying the vibes, consider sharing the stream with a friend.',
    'Lurkers welcome! Don’t be shy, drop a hello 👋',
    'Got questions? Ask away - we love chatting with the community.'
  ],

  commands: [
    'See something dumb on stream? Use !clipit to capture it!',
    'To view a list of commands, use !commands',
    'Want a shoutout for your channel? Mods can use !so <name>'
  ],

  socials: [
    'Continue the conversation over on Discord! https://discord.gg/nth7y8TqMT',
    'Follow me on Twitter/X for updates: https://x.com/pnkllr'
  ],

  promo: [
    "Check out our Wick'd Geek Collection! https://wickdgeek.com",
    'Need tools for your stream? Head on over to https://tools.pnkllr.net',
    'Grab some merch 👉 https://weartrulight.com'
  ],

  fun: [
    'Hydrate check! 💧 Drink some water while you’re watching.',
    'Stretch break! 🧘‍♂️ We’ve been sitting too long.',
    'Pro tip: clips are forever... embarrass me responsibly 😎',
    'Chat messages power the stream - silence drains my energy bar ⚡'
  ]

};

function getRandomTimer() {
  const categories =
    Object.keys(timerPools);

  const category =
    pickRandom(categories);

  const messages =
    timerPools[category];

  return pickRandom(messages);
}

async function discTimer() {
  try {
    const viewers =
      await getViewerCount();

    if (
      viewers !== null &&
      viewers > 0
    ) {
      const message =
        getRandomTimer();

      safeSay(
        TWITCH_CHANNEL,
        message
      );

      console.log(
        `[Timer] Sent: ${message}`
      );

    } else {
      console.log(
        viewers === null
          ? '[Timer] Skipped - Twitch API unavailable.'
          : '[Timer] Skipped - stream offline.'
      );
    }

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

  chatTimerInterval =
    setInterval(
      discTimer,
      config.timers.chat
    );

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
````
