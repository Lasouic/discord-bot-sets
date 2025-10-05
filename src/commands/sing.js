import fs from 'fs';
import * as playdl from 'play-dl';
import { searchYoutube } from '../utils/youtube.js';
import { getGuildQueue, ensureConnection, startIfIdle, skip as skipQueue, clearQueue, destroyGuildQueue } from '../music/queue.js';
import { VoiceConnectionStatus } from '@discordjs/voice';

// ======== 你已有的 Token 初始化（保持你的版本）========
const tokens = {
  useragent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
};

let scClientId = null;

if (fs.existsSync('./cookies.txt')) {
  const cookie = fs.readFileSync('./cookies.txt', 'utf8').trim();
  tokens.youtube = { cookie };
  console.log('✅ YouTube Cookie 已加载');
} else {
  console.warn('⚠️ 没有找到 cookies.txt，可能会被 YouTube 拦截');
}

try {
  scClientId = process.env.SOUNDCLOUD_CLIENT_ID || await playdl.getFreeClientID();
  if (scClientId) {
    tokens.soundcloud = { client_id: scClientId };
    console.log('✅ SoundCloud client_id 已配置');
  } else {
    console.warn('⚠️ 未获取到 SoundCloud client_id，将无法使用 SoundCloud 回退');
  }
} catch (e) {
  console.warn('⚠️ 获取 SoundCloud client_id 失败，将无法使用 SoundCloud 回退：', e?.message || e);
}

await playdl.setToken(tokens);

// ======== 核心：统一的取流函数（含 YT→SC 回退）========
async function fetchStream(urlOrYtUrl, fallbackQuery) {
  try {
    return await playdl.stream(urlOrYtUrl);
  } catch (err) {
    const combined = String(err?.message || err || '');
    const needVerify = /not a bot|confirm you.?re not a bot|captcha|consent|429|410/i.test(combined);
    if (!needVerify) throw err;

    if (!scClientId) {
      throw new Error('YouTube 要求验证且未配置 SoundCloud client_id');
    }
    // 回退 SoundCloud：用 fallbackQuery 搜
    const sc = await playdl.search(fallbackQuery, { source: { soundcloud: 'tracks' }, limit: 1 });
    if (!sc?.[0]?.url) throw new Error('回退 SoundCloud 未找到可用音源');
    return await playdl.stream(sc[0].url);
  }
}

// ======== 指令：!sing 追加到队列并开播 ========
export async function handleSingCommand(message, query) {
  const channel = message.member?.voice?.channel;
  if (!channel) {
    await message.reply('❌ 你需要先加入语音频道');
    return;
  }

  const video = await searchYoutube(query);
  if (!video) {
    await message.reply('😢 没找到相关歌曲');
    return;
  }

  const guildQueue = getGuildQueue(message.guild.id);
  // 建立语音连接（如果没建）
  try {
    await ensureConnection(guildQueue, message.guild, channel);
  } catch (e) {
    console.error('语音连接失败:', e);
    await message.reply('❌ 无法连接到语音频道，请稍后再试。');
    return;
  }

  // 入队
  guildQueue.queue.push({
    title: video.title,
    url: video.url,             // 优先尝试 YT 播放
    fallbackQuery: query        // 若 YT 被验证，回退到 SoundCloud 用这个词再搜
  });

  await message.reply(`➕ 已加入队列：**${video.title}**`);

  // 如果播放器空闲，立即开始播
  await startIfIdle(
    guildQueue,
    fetchStream,
    (track) => message.channel.send(`🎶 正在播放：**${track.title}**`),
    (err, track) => {
      console.error('播放出错:', err);
      message.channel.send(`⚠️ **${track?.title ?? '未知曲目'}** 播放失败，尝试下一首…`);
    },
    () => message.channel.send('✅ 队列播放完毕，已断开语音。')
  );
}

// ======== 指令：!skip 立刻切到下一首 ========
export async function handleSkipCommand(message) {
  const q = getGuildQueue(message.guild.id);
  if (!q || (!q.nowPlaying && q.queue.length === 0)) {
    await message.reply('📭 队列为空，无法切歌。');
    return;
  }
  skipQueue(
    q,
    fetchStream,
    (track) => message.channel.send(`⏭️ 跳过，正在播放：**${track.title}**`),
    (err, track) => {
      console.error('切歌出错:', err);
      message.channel.send(`⚠️ **${track?.title ?? '未知曲目'}** 播放失败，尝试下一首…`);
    },
    () => message.channel.send('✅ 队列播放完毕，已断开语音。')
  );
}

// ======== 指令：!stop 清空并断开 ========
export async function handleStopCommand(message) {
  const q = getGuildQueue(message.guild.id);
  if (!q) {
    await message.reply('👌 已停止（无连接）。');
    return;
  }
  clearQueue(q);
  try {
    if (q.connection && q.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      q.connection.destroy();
    }
  } catch (_) {}
  await message.reply('🛑 已停止播放并清空队列。');
  destroyGuildQueue(message.guild.id);
}

// ======== 指令：!queue 查看队列 ========
export async function handleQueueCommand(message) {
  const q = getGuildQueue(message.guild.id);
  const now = q?.nowPlaying ? `🎵 现在：**${q.nowPlaying.title}**` : '🎵 现在：无';
  const rest = q?.queue?.length
    ? q.queue.map((t, i) => `${i + 1}. ${t.title}`).slice(0, 10).join('\n')
    : '（空）';
  await message.reply(`${now}\n📜 队列：\n${rest}`);
}