import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import {
  handleSingCommand,
  handleAnotherCommand,
  handleSkipCommand,
  handleStopCommand,
  handleQueueCommand,
} from './commands/sing.js';
import { parseCommand } from './utils/commandParser.js';

const commandRegistry = new Map();
const uniqueEntries = new Set();

function registerCommand({ name, aliases = [], usage, description, run }) {
  const entry = { name, aliases, usage, description, run };
  uniqueEntries.add(entry);

  const keys = new Set([name.toLowerCase(), ...aliases.map((alias) => alias.toLowerCase())]);
  for (const key of keys) {
    commandRegistry.set(key, entry);
  }

  return entry;
}

registerCommand({
  name: 'sing',
  aliases: ['radio'],
  usage: '!sing 周杰伦',
  description: '开启指定歌手的随机电台，持续放歌。',
  run: async (message, args) => {
    const query = args?.trim();
    if (!query) {
      return message.reply('🎤 想听谁唱歌呢？用法：`!sing 歌手名`');
    }
    return handleSingCommand(message, query);
  },
});

registerCommand({
  name: 'another',
  usage: '!another',
  description: '换下一首同歌手的歌。',
  run: handleAnotherCommand,
});

registerCommand({
  name: 'skip',
  usage: '!skip',
  description: '跳过正在播放的歌曲。',
  run: handleSkipCommand,
});

registerCommand({
  name: 'stop',
  usage: '!stop',
  description: '停止播放并离开语音频道。',
  run: handleStopCommand,
});

registerCommand({
  name: 'queue',
  usage: '!queue',
  description: '查看当前播放队列。',
  run: handleQueueCommand,
});

registerCommand({
  name: 'ping',
  usage: '!ping',
  description: '检查机器人状态。',
  run: (message) => message.reply('✨ pong! 机器人随时待命~'),
});

function getCommand(name) {
  return commandRegistry.get(name.toLowerCase());
}

function listCommands() {
  return [...uniqueEntries];
}

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error('Missing DISCORD_BOT_TOKEN. Put it in .env or environment.');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ ClientReady: Logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    const parsed = parseCommand(message.content ?? '');
    if (!parsed) return;

    const command = getCommand(parsed.name);
    if (!command) {
      if (parsed.name === 'help') {
        const lines = listCommands()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((cmd) => `• **${cmd.usage}** — ${cmd.description}`);
        await message.reply(
          '📚 可用指令：\n' + lines.join('\n') + '\n📝 更多指令敬请期待！'
        );
      }
      return;
    }

    await command.run(message, parsed.args);
  } catch (err) {
    console.error('messageCreate handler error:', err);
    if (message?.channel) {
      try {
        await message.reply('😵 机器人刚刚绊了一下脚，请稍后再试。');
      } catch (replyError) {
        console.error('failed to send fallback reply:', replyError);
      }
    }
  }
});

process.on('unhandledRejection', (r) => console.error('UNHANDLED REJECTION:', r));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

client.login(token);