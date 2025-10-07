import * as playdl from 'play-dl';
import {
  getGuildQueue,
  ensureConnection,
  startIfIdle,
  skip as skipQueue,
  clearQueue,
  destroyGuildQueue,
} from '../music/queue.js';
import { VoiceConnectionStatus } from '@discordjs/voice';
import { getPlaybackTokens } from '../music/playbackTokens.js';

const MIN_TRACK_SECONDS = 60;
const RADIO_RECENT_LIMIT = 12;
const NEGATIVE = /\b(live|cover|remix|remastered|sped\s*up|slowed|nightcore|8d|8\-?d|short|tiktok|舞台|现场)\b/i;

const friendlyReplies = {
  joinVoice: '❌ 先加入语音频道，我们马上就播歌给你听~',
  notFound: (artist) => `😢 没找到和 **${artist}** 有关的歌，换个关键词试试？`,
  noRadioYet: '📭 目前还没开启电台，先用 `!sing 歌手` 来点歌吧。',
  queueEmpty: '📭 队列里暂时没有可以跳过的歌曲。',
  noMoreSongs: (artist) => `😢 暂时没有新的 **${artist}** 歌曲可切换，我们再多搜搜。`,
  stopDone: '🛑 已结束播放，机器人先撤退啦~',
};

const { scClientId } = await getPlaybackTokens();

const recentByGuild = new Map(); // guildId -> { artist: string, ids: Set<string>, max: number }

function filterSC(tracks, excludeIds) {
  return (tracks ?? []).filter((t) => {
    const id = t?.id ?? t?.permalink;
    const title = t?.title || t?.name;
    const url = t?.url;
    const dur = t?.durationInSec ?? 0;
    if (!id || !title || !url) return false;
    if (excludeIds.has(String(id))) return false;
    if (dur < MIN_TRACK_SECONDS) return false;
    if (NEGATIVE.test(String(title))) return false;
    return true;
  });
}

async function getRandomTrackForArtist(artist, excludeIds = new Set()) {
  const queries = [artist, `${artist} audio`];
  let pool = [];
  for (const q of queries) {
    const res = await playdl.search(q, { source: { soundcloud: 'tracks' }, limit: 30 }).catch(() => []);
    pool = pool.concat(filterSC(res, excludeIds));
    if (pool.length >= 10) break;
  }
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return {
    id: pick?.id ?? pick?.permalink ?? pick?.url,
    title: pick?.title || pick?.name,
    url: pick?.url,
    duration: pick?.durationInSec,
    artist: pick?.user?.name,
    thumbnail: pick?.thumbnail || pick?.image || pick?.artworkUrl,
    source: 'soundcloud',
    fallbackQuery: artist,
  };
}

async function fetchStream(track) {
  if (!track || typeof track !== 'object') {
    throw new Error('无效的曲目对象');
  }
  if (!track.url) {
    throw new Error('无效的曲目 URL');
  }

  return await playdl.stream(track.url);
}

function getRecentSet(guildId, artist) {
  let record = recentByGuild.get(guildId);
  if (!record || record.artist !== artist) {
    record = { artist, ids: new Set(), max: RADIO_RECENT_LIMIT };
    recentByGuild.set(guildId, record);
  }
  return record;
}

function rememberPlayed(guildId, artist, id) {
  if (!id) return;
  const record = getRecentSet(guildId, artist);
  record.ids.add(String(id));
  if (record.ids.size > record.max) {
    const first = record.ids.values().next().value;
    record.ids.delete(first);
  }
}

function describeRadioStart(artist, track) {
  return [
    `📻 **${artist}** 电台启动！`,
    `➕ 已加入：**${track.title}**`,
    '➡️ `!another` 换下一首，`!stop` 结束。',
  ].join('\n');
}

function createPlaybackLifecycle(message, { label = '播放', startPrefix = '🎶 正在播放：' } = {}) {
  const guildId = message.guild?.id;
  return {
    onStart: (track) => void message.channel.send(`${startPrefix}**${track.title}**`),
    onError: (err, track) => {
      console.error(`${label}出错:`, err);
      void message.channel.send(`⚠️ **${track?.title ?? '未知曲目'}** 播放失败，我们试试下一首…`);
    },
    onFinish: () => {
      if (guildId) {
        recentByGuild.delete(guildId);
      }
      void message.channel.send('✅ 电台播放结束（或已停止）。');
    },
  };
}

function formatQueue(guildQueue) {
  const nowPlaying = guildQueue?.nowPlaying
    ? `🎵 现在：**${guildQueue.nowPlaying.title}**`
    : '🎵 现在：暂无播放';

  const upcoming = guildQueue?.queue?.length
    ? guildQueue.queue
        .slice(0, 10)
        .map((track, index) => `${index + 1}. ${track.title}`)
        .join('\n')
    : '（空空如也，来点一首吧~）';

  return `${nowPlaying}\n📜 队列：\n${upcoming}`;
}

export async function handleSingCommand(message, artist) {
  destroyGuildQueue(message.guild.id);
  recentByGuild.delete(message.guild.id);

  const channel = message.member?.voice?.channel;
  if (!channel) return message.reply(friendlyReplies.joinVoice);

  const guildQueue = getGuildQueue(message.guild.id);
  try {
    await ensureConnection(guildQueue, message.guild, channel);
  } catch (error) {
    console.error('语音连接失败:', error);
    return message.reply('❌ 无法连接到语音频道，请稍后再试。');
  }

  const recent = getRecentSet(message.guild.id, artist);
  const firstTrack = await getRandomTrackForArtist(artist, recent.ids);
  if (!firstTrack) {
    return message.reply(friendlyReplies.notFound(artist));
  }

  rememberPlayed(message.guild.id, artist, firstTrack.id);
  guildQueue.queue.push(firstTrack);

  await message.reply(describeRadioStart(artist, firstTrack));

  const getNextTrack = async () => {
    const next = await getRandomTrackForArtist(artist, recent.ids);
    if (next) rememberPlayed(message.guild.id, artist, next.id);
    return next;
  };

  guildQueue.trackSupplier = getNextTrack;
  const lifecycle = createPlaybackLifecycle(message);

  await startIfIdle(
    guildQueue,
    fetchStream,
    lifecycle.onStart,
    lifecycle.onError,
    lifecycle.onFinish,
    getNextTrack
  );
}

export async function handleAnotherCommand(message) {
  const guildQueue = getGuildQueue(message.guild.id);
  const nowArtist = guildQueue?.nowPlaying?.fallbackQuery || null;
  if (!guildQueue || !nowArtist) {
    return message.reply(friendlyReplies.noRadioYet);
  }

  const recent = getRecentSet(message.guild.id, nowArtist);
  const next = await getRandomTrackForArtist(nowArtist, recent.ids);
  if (!next) {
    return message.reply(friendlyReplies.noMoreSongs(nowArtist));
  }

  rememberPlayed(message.guild.id, nowArtist, next.id);
  guildQueue.queue.push(next);

  const lifecycle = createPlaybackLifecycle(message, {
    label: '切歌',
    startPrefix: '⏭️ 下一首：',
  });

  await skipQueue(
    guildQueue,
    fetchStream,
    lifecycle.onStart,
    lifecycle.onError,
    lifecycle.onFinish,
    null
  );
}

export async function handleSkipCommand(message) {
  const guildQueue = getGuildQueue(message.guild.id);
  if (!guildQueue || (!guildQueue.nowPlaying && guildQueue.queue.length === 0)) {
    return message.reply(friendlyReplies.queueEmpty);
  }

  const lifecycle = createPlaybackLifecycle(message, {
    label: '切歌',
    startPrefix: '⏭️ 下一首：',
  });

  await skipQueue(
    guildQueue,
    fetchStream,
    lifecycle.onStart,
    lifecycle.onError,
    lifecycle.onFinish,
    null
  );
}

export async function handleStopCommand(message) {
  const guildQueue = getGuildQueue(message.guild.id);
  if (!guildQueue) {
    return message.reply(friendlyReplies.stopDone);
  }

  clearQueue(guildQueue);
  guildQueue.trackSupplier = null;
  guildQueue.nowPlaying = null;
  try {
    if (guildQueue.connection && guildQueue.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      guildQueue.connection.destroy();
    }
  } catch (error) {
    console.warn('销毁语音连接时出错:', error);
  }
  destroyGuildQueue(message.guild.id);
  recentByGuild.delete(message.guild.id);
  await message.reply(friendlyReplies.stopDone);
}

export async function handleQueueCommand(message) {
  const guildQueue = getGuildQueue(message.guild.id);
  await message.reply(formatQueue(guildQueue));
}