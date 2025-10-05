import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState, VoiceConnectionStatus } from '@discordjs/voice';
import * as playdl from 'play-dl';

const queues = new Map(); // guildId -> { connection, channel, player, queue: [], nowPlaying, scClientId }

export function getGuildQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      connection: null,
      channel: null,
      player: createAudioPlayer(),
      queue: [],
      nowPlaying: null,
      scClientId: null, // 可选：如果你在别处拿到了 scClientId，也能塞这里
      onIdleBound: false,
    });
  }
  return queues.get(guildId);
}

export function destroyGuildQueue(guildId) {
  const q = queues.get(guildId);
  if (!q) return;
  try {
    q.player?.stop();
    if (q.connection && q.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      q.connection.destroy();
    }
  } catch (_) {}
  queues.delete(guildId);
}

export async function ensureConnection(guildQueue, guild, voiceChannel) {
  if (guildQueue.connection && guildQueue.connection.state.status !== VoiceConnectionStatus.Destroyed) return;
  guildQueue.channel = voiceChannel;
  guildQueue.connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator
  });
  await entersState(guildQueue.connection, VoiceConnectionStatus.Ready, 30_000);
  guildQueue.connection.subscribe(guildQueue.player);
}

export async function startIfIdle(guildQueue, fetchStream, onStart, onError, onFinish) {
  if (guildQueue.player.state.status === AudioPlayerStatus.Playing) return;
  playNext(guildQueue, fetchStream, onStart, onError, onFinish);
}

export function skip(guildQueue, fetchStream, onStart, onError, onFinish) {
  // 直接停止当前，Idle 事件触发后会播下一首；为了立即切，手动推进：
  guildQueue.player.stop(true);
  playNext(guildQueue, fetchStream, onStart, onError, onFinish);
}

export function clearQueue(guildQueue) {
  guildQueue.queue.length = 0;
}

async function playNext(guildQueue, fetchStream, onStart, onError, onFinish) {
  if (!guildQueue.queue.length) {
    // 队列空了就清场
    onFinish?.();
    destroyGuildQueue(guildQueue.channel.guild.id);
    return;
  }

  const track = guildQueue.queue.shift();
  guildQueue.nowPlaying = track;

  try {
    const streamObj = await fetchStream(track.url, track.fallbackQuery); // 你会在 sing.js 里实现
    const resource = createAudioResource(streamObj.stream, { inputType: streamObj.type });
    guildQueue.player.play(resource);
    onStart?.(track);
  } catch (err) {
    onError?.(err, track);
    // 播放失败：尝试下一首
    return playNext(guildQueue, fetchStream, onStart, onError, onFinish);
  }

  if (!guildQueue.onIdleBound) {
    guildQueue.onIdleBound = true;
    guildQueue.player.on(AudioPlayerStatus.Idle, () => {
      playNext(guildQueue, fetchStream, onStart, onError, onFinish);
    });
    guildQueue.player.on('error', (e) => {
      onError?.(e, guildQueue.nowPlaying);
      playNext(guildQueue, fetchStream, onStart, onError, onFinish);
    });
  }
}