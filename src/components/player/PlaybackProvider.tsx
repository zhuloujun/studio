"use client";

import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import type { FavoriteItem, NoteFavoriteItem, TTSSettings, MediaFavoriteItem, PlaybackMode } from '@/types';
import { getCloudSpeech } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import * as LocalStorage from '@/lib/localStorageService';

const PUNCTUATION_REGEX_FOR_SPLIT = /([.,?!,。？！，、\n\r]+)/g;
const PUNCTUATION_REGEX = /[.,?!,。？！，、\n\r"“„”'‘’`*_{}\[\]()#&@:;~<>/\\|\-—–^%$《》]/g;

type PlayableItem =
  | { type: 'favorite'; item: FavoriteItem }
  | { type: 'note_favorite'; item: NoteFavoriteItem; part?: 'original' | 'note' }
  | { type: 'media_favorite'; item: MediaFavoriteItem };

interface PlaybackContextType {
  isPlaying: boolean;
  isPaused: boolean;
  isLoading: boolean;
  currentItem: PlayableItem | null;
  playlist: PlayableItem[];
  currentText: string;
  play: (item: PlayableItem, playlist: PlayableItem[], startIndex: number) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
  hasNext: () => boolean;
  hasPrevious: () => boolean;
  playbackMode: PlaybackMode;
  setPlaybackMode: (mode: PlaybackMode) => void;
  originalTextTtsSettings: TTSSettings;
  setOriginalTextTtsSettings: React.Dispatch<React.SetStateAction<TTSSettings>>;
  yourNoteTtsSettings: TTSSettings;
  setYourNoteTtsSettings: React.Dispatch<React.SetStateAction<TTSSettings>>;
  audioPlayerRef: React.RefObject<HTMLAudioElement>;
  setVideoPlayerRef: (node: HTMLVideoElement | null) => void;
  progress: number;
  duration: number;
  handleSeek: (value: number) => void;
  videoAspectRatio: number | null;
}

const PlaybackContext = createContext<PlaybackContextType | undefined>(undefined);

export const usePlayback = () => {
  const context = useContext(PlaybackContext);
  if (!context) {
    throw new Error('usePlayback must be used within a PlaybackProvider');
  }
  return context;
};

export const PlaybackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toast } = useToast();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentItem, setCurrentItem] = useState<PlayableItem | null>(null);
  const [playlist, setPlaylist] = useState<PlayableItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [currentText, setCurrentText] = useState('');
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('default');
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);

  const [originalTextTtsSettings, setOriginalTextTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  const [yourNoteTtsSettings, setYourNoteTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const [videoPlayer, setVideoPlayer] = useState<HTMLVideoElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechQueueRef = useRef<{ text: string; settings: TTSSettings; part?: 'original' | 'note' }[]>([]);
  const segmentIndexRef = useRef(0);
  const mediaObjectUrlRef = useRef<string | null>(null);
  
  const isPlayingRef = useRef(false);
  const isPausedRef = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && !audioPlayerRef.current) {
        audioPlayerRef.current = new Audio();
    }
  }, []);

  const stop = useCallback((resetPlayerState = true) => {
    isPlayingRef.current = false;
    isPausedRef.current = false;
    speechQueueRef.current = [];
    segmentIndexRef.current = 0;

    if (utteranceRef.current) {
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
    }
    utteranceRef.current = null;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        if(window.speechSynthesis.speaking || window.speechSynthesis.pending) {
            window.speechSynthesis.cancel();
        }
    }

    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      if(audioPlayerRef.current.src) {
        audioPlayerRef.current.removeAttribute('src');
        audioPlayerRef.current.load();
      }
    }
    if (videoPlayer) {
      videoPlayer.pause();
      if(videoPlayer.src) {
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
      }
    }
    
    if (mediaObjectUrlRef.current) {
        URL.revokeObjectURL(mediaObjectUrlRef.current);
        mediaObjectUrlRef.current = null;
    }

    if (resetPlayerState) {
        setIsPlaying(false);
        setIsPaused(false);
        setIsLoading(false);
        setCurrentItem(null);
        setCurrentText('');
        setCurrentIndex(-1);
        setPlaylist([]);
        setProgress(0);
        setDuration(0);
        setVideoAspectRatio(null);
    }
    if (typeof navigator !== 'undefined' && navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
    }
  }, [videoPlayer]);

  const onPlaybackEndRef = useRef<() => void>();

  const speakNextSegment = useCallback(async (isResuming = false) => {
    if (!isPlayingRef.current || isPausedRef.current) {
      if (!isPausedRef.current && speechQueueRef.current.length === 0) stop();
      return;
    }

    if (speechQueueRef.current.length === 0) {
        if (onPlaybackEndRef.current) {
          onPlaybackEndRef.current();
        }
        return;
    }

    const currentPart = speechQueueRef.current[0];
    const segments = (currentPart.text.split(PUNCTUATION_REGEX_FOR_SPLIT) || [currentPart.text]).filter(Boolean);
    
    if (segmentIndexRef.current >= segments.length) {
      speechQueueRef.current.shift();
      segmentIndexRef.current = 0;
      speakNextSegment();
      return;
    }

    setIsLoading(true);
    
    const segmentText = segments[segmentIndexRef.current];
    const cleanedText = segmentText.replace(PUNCTUATION_REGEX, ' ').trim();

    setCurrentText(cleanedText);
    const itemForMeta = currentItem;
    if (itemForMeta?.type === 'note_favorite') {
      setCurrentItem(prev => prev ? {...prev, part: currentPart.part} : null);
    }
    
    if (typeof navigator !== 'undefined' && navigator.mediaSession && itemForMeta) {
        let title = cleanedText || (itemForMeta.type === 'media_favorite' ? itemForMeta.item.name : 'Reading...');
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title,
          artist: itemForMeta.item.sourceDocumentName || 'MangaTalk',
          album: itemForMeta.type === 'favorite' ? 'Favorited Texts' : (itemForMeta.type === 'note_favorite' ? 'Favorited Notes' : 'Media Favorites'),
        });
    }

    if (!cleanedText) {
      segmentIndexRef.current++;
      speakNextSegment();
      return;
    }
    
    if (currentPart.settings.engine === 'local') {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
        stop(); return;
      }
      const utterance = new SpeechSynthesisUtterance(cleanedText);
      utterance.lang = currentPart.settings.language;
      utterance.pitch = currentPart.settings.pitch;
      utterance.rate = currentPart.settings.rate;
      if (currentPart.settings.voiceURI) {
        const voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === currentPart.settings.voiceURI);
        if (voice) utterance.voice = voice;
      }
      
      utterance.onend = () => {
          if (utteranceRef.current === utterance && isPlayingRef.current && !isPausedRef.current) {
              segmentIndexRef.current++;
              speakNextSegment();
          }
      };

      utterance.onerror = (event) => {
          if(utteranceRef.current === utterance && event.error !== 'canceled' && event.error !== 'interrupted' && isPlayingRef.current) {
              console.error('SpeechSynthesis Error:', event);
              toast({ variant: "destructive", title: "TTS Error", description: event.error || "Speech failed." });
              stop();
          }
      };
      
      utteranceRef.current = utterance;
      setIsLoading(false);
      window.speechSynthesis.speak(utterance);
      
    } else {
      try {
        const result = await getCloudSpeech(cleanedText, currentPart.settings.language, currentPart.settings.cloudVoiceId);
        if (!isPlayingRef.current) return;

        if ('audioUrl' in result && audioPlayerRef.current) {
          audioPlayerRef.current.src = result.audioUrl;
          await audioPlayerRef.current.play(); 
        } else if ('error' in result) {
          toast({ variant: "destructive", title: "Cloud TTS Error", description: result.error });
          stop();
        }
      } catch (error: any) {
        if (!isPlayingRef.current) return;
        toast({ variant: "destructive", title: "Cloud TTS Failed", description: error.message });
        stop();
      }
    }
  }, [stop, toast, currentItem]);

  const handleTTSPlayback = useCallback(async (item: PlayableItem, newPlaylist: PlayableItem[], startIndex: number) => {
    speechQueueRef.current = [];
    segmentIndexRef.current = 0;
    
    setCurrentItem(item);
    setPlaylist(newPlaylist);
    setCurrentIndex(startIndex);

    if (item.type === 'favorite') {
      speechQueueRef.current.push({ text: item.item.text, settings: originalTextTtsSettings });
    } else if (item.type === 'note_favorite') {
      if (item.item.annotation.targetText) {
        speechQueueRef.current.push({ text: item.item.annotation.targetText, settings: originalTextTtsSettings, part: 'original' });
      }
      if (item.item.annotation.note) {
        speechQueueRef.current.push({ text: item.item.annotation.note, settings: yourNoteTtsSettings, part: 'note' });
      }
    }
    
    speakNextSegment();
  }, [originalTextTtsSettings, yourNoteTtsSettings, speakNextSegment]);
  
  const pendingVideoItemRef = useRef<MediaFavoriteItem | null>(null);

  const startMediaFavoritePlayback = useCallback(async (player: HTMLAudioElement | HTMLVideoElement, mediaItem: MediaFavoriteItem) => {
    setCurrentText(mediaItem.name);
    if (typeof navigator !== 'undefined' && navigator.mediaSession) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: mediaItem.name,
          artist: mediaItem.sourceDocumentName || 'MangaTalk',
          album: 'Media Favorites',
        });
    }
    // Prefer the server-streamed URL (works for any file size, supports
    // seeking) over building a Blob from in-memory fileData.
    const url = mediaItem.fileUrl || URL.createObjectURL(new Blob([mediaItem.fileData], { type: mediaItem.originalType }));
    mediaObjectUrlRef.current = mediaItem.fileUrl ? null : url;
    player.src = url;
    try {
        await player.play();
        if (typeof navigator !== 'undefined' && navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
    } catch (e: any) {
         if (e.name !== 'AbortError') {
          console.error("Media playback error:", e);
          toast({ variant: "destructive", title: "Playback Error", description: `The media file could not be played.` });
          stop();
        }
    }
  }, [stop, toast]);

  // The <video> element only exists in the DOM while the floating player is
  // showing a video (see FloatingPlayer.tsx), so on the first video playback
  // of a session - or any time after playback was fully stopped - `videoPlayer`
  // is briefly null exactly when play() runs. Rather than failing with
  // "Player is not available", queue the request and fulfil it as soon as
  // the element mounts and this effect sees it.
  useEffect(() => {
    if (videoPlayer && pendingVideoItemRef.current) {
      const mediaItem = pendingVideoItemRef.current;
      pendingVideoItemRef.current = null;
      startMediaFavoritePlayback(videoPlayer, mediaItem);
    }
  }, [videoPlayer, startMediaFavoritePlayback]);

  const play = useCallback(async (item: PlayableItem, newPlaylist: PlayableItem[], startIndex: number) => {
    stop(false);
    
    isPlayingRef.current = true;
    isPausedRef.current = false;
    
    setIsPlaying(true);
    setIsPaused(false);
    setIsLoading(true);
    setProgress(0);
    setDuration(0);

    if (item.type === 'media_favorite') {
        setCurrentItem(item);
        setPlaylist(newPlaylist);
        setCurrentIndex(startIndex);

        if (item.item.type === 'video') {
            if (videoPlayer) {
                await startMediaFavoritePlayback(videoPlayer, item.item);
            } else {
                // Video element not mounted yet this render cycle - the effect
                // above will pick this up as soon as it is.
                pendingVideoItemRef.current = item.item;
            }
            return;
        }

        const player = audioPlayerRef.current;
        if (!player) {
            toast({ variant: "destructive", title: "Playback Error", description: "Player is not available." });
            stop();
            return;
        }
        await startMediaFavoritePlayback(player, item.item);
    } else { 
        handleTTSPlayback(item, newPlaylist, startIndex);
    }

  }, [stop, videoPlayer, toast, handleTTSPlayback, startMediaFavoritePlayback]);
  
  const onPlaybackEnd = useCallback(() => {
    if (!isPlayingRef.current) return;
  
    const item = currentItem;
    if (!item) {
        stop();
        return;
    }
  
    let mode: PlaybackMode = 'default';
    if (item.type === 'favorite') {
      mode = LocalStorage.loadFavoritesPlaybackMode();
    } else if (item.type === 'note_favorite') {
      mode = LocalStorage.loadNotesPlaybackMode();
    } else if (item.type === 'media_favorite') {
      mode = LocalStorage.loadMediaPlaybackMode();
    }
  
    if (mode === 'loop-single') {
        if (item.type === 'media_favorite') {
            const player = item.item.type === 'video' ? videoPlayer : audioPlayerRef.current;
            if(player) {
                player.currentTime = 0;
                player.play();
            }
        } else {
            handleTTSPlayback(item, playlist, currentIndex);
        }
    } else if (mode === 'sequential' && playlist.length > 0) {
      const nextIndex = (currentIndex + 1) % playlist.length;
      const nextItem = playlist[nextIndex];
      play(nextItem, playlist, nextIndex);
    } else {
      stop();
    }
  }, [currentItem, playlist, currentIndex, videoPlayer, stop, handleTTSPlayback, play]);

  useEffect(() => {
    onPlaybackEndRef.current = onPlaybackEnd;
  }, [onPlaybackEnd]);
  
  const pause = useCallback(() => {
    if (!isPlayingRef.current || isPausedRef.current) return;
    
    isPausedRef.current = true;
    setIsPaused(true);
    
    // For local TTS, we must cancel it to prevent the `onend` event from firing.
    // We can't save the progress within a word, so we just cancel.
    if (utteranceRef.current && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    
    audioPlayerRef.current?.pause();
    videoPlayer?.pause();

    if (typeof navigator !== 'undefined' && navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'paused';
    }
  }, [videoPlayer]);

  const resume = useCallback(() => {
    if (!isPlayingRef.current || !isPausedRef.current) return;

    isPausedRef.current = false;
    setIsPaused(false);
    
    if (typeof navigator !== 'undefined' && navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'playing';
    }

    if (currentItem?.type === 'media_favorite') {
        const player = currentItem.item.type === 'video' ? videoPlayer : audioPlayerRef.current;
        player?.play().catch(() => stop());
    } else {
        speakNextSegment(true); // Re-start speech from the current segment.
    }
  }, [currentItem, videoPlayer, stop, speakNextSegment]);

  const handleSeek = (value: number) => {
    const player = currentItem?.type === 'media_favorite' 
      ? (currentItem.item.type === 'video' ? videoPlayer : audioPlayerRef.current)
      : audioPlayerRef.current;

    if (player && player.duration) {
      player.currentTime = (value / 100) * player.duration;
      setProgress(value);
    }
  };

  const hasNext = useCallback(() => {
      const mode = currentItem?.type === 'favorite' ? LocalStorage.loadFavoritesPlaybackMode()
                 : currentItem?.type === 'note_favorite' ? LocalStorage.loadNotesPlaybackMode()
                 : currentItem?.type === 'media_favorite' ? LocalStorage.loadMediaPlaybackMode()
                 : 'default';
      if (mode === 'sequential' && playlist.length > 0) return true;
      return currentIndex > -1 && currentIndex < playlist.length - 1;
  }, [currentIndex, playlist.length, currentItem]);

  const hasPrevious = useCallback(() => {
      const mode = currentItem?.type === 'favorite' ? LocalStorage.loadFavoritesPlaybackMode()
                 : currentItem?.type === 'note_favorite' ? LocalStorage.loadNotesPlaybackMode()
                 : currentItem?.type === 'media_favorite' ? LocalStorage.loadMediaPlaybackMode()
                 : 'default';
      if (mode === 'sequential' && playlist.length > 0) return true;
      return currentIndex > 0;
  }, [currentIndex, currentItem, playlist.length]);

  const next = useCallback(() => {
    if (hasNext()) {
        const nextIndex = (currentIndex + 1) % playlist.length;
        const nextItem = playlist[nextIndex];
        play(nextItem, playlist, nextIndex);
    }
  }, [currentIndex, hasNext, playlist, play]);

  const previous = useCallback(() => {
    if (hasPrevious()) {
        const prevIndex = (currentIndex - 1 + playlist.length) % playlist.length;
        const prevItem = playlist[prevIndex];
        play(prevItem, playlist, prevIndex);
    }
  }, [currentIndex, hasPrevious, playlist, play]);
  

  useEffect(() => {
    const handlePlaying = (e: any) => { 
        if (isPlayingRef.current) setIsLoading(false);
    };

    const handleLoadedMetadata = (e: any) => {
        setDuration(e.target.duration);
        if (e.target.tagName === 'VIDEO') {
            const aspectRatio = e.target.videoWidth / e.target.videoHeight;
            setVideoAspectRatio(aspectRatio);
        }
    };
    
    const handleError = (e: any) => {
        const error = e?.target?.error;
        if (error && error.code === MediaError.MEDIA_ERR_ABORTED) {
            console.warn("Playback was aborted, likely by a new user action. Ignoring error.");
            return;
        }

        if (isPlayingRef.current) {
            toast({variant: "destructive", title: "Media Error", description: "Failed to play media."});
            stop();
        }
    };
    
    const handleTimeUpdate = (e: any) => {
        if(e.target.duration > 0) {
            setProgress((e.target.currentTime / e.target.duration) * 100);
        }
    }

    const ttsAudioPlayer = audioPlayerRef.current; 
    const handleTtsEnded = () => {
        if(isPlayingRef.current && !isPausedRef.current) {
            segmentIndexRef.current++;
            speakNextSegment();
        }
    };
    if (ttsAudioPlayer) {
      ttsAudioPlayer.addEventListener('ended', handleTtsEnded);
      ttsAudioPlayer.addEventListener('playing', handlePlaying);
      ttsAudioPlayer.addEventListener('error', handleError);
    }

    const mediaPlayers = [audioPlayerRef.current, videoPlayer].filter(Boolean);
    mediaPlayers.forEach(player => {
        player?.addEventListener('ended', () => { if(onPlaybackEndRef.current) onPlaybackEndRef.current() }); 
        player?.addEventListener('playing', handlePlaying);
        player?.addEventListener('loadedmetadata', handleLoadedMetadata);
        player?.addEventListener('timeupdate', handleTimeUpdate);
        player?.addEventListener('error', handleError);
    });

    if (typeof navigator !== 'undefined' && navigator.mediaSession) {
      navigator.mediaSession.setActionHandler('play', resume);
      navigator.mediaSession.setActionHandler('pause', pause);
      navigator.mediaSession.setActionHandler('nexttrack', hasNext() ? next : null);
      navigator.mediaSession.setActionHandler('previoustrack', hasPrevious() ? previous : null);
      navigator.mediaSession.setActionHandler('stop', stop);
    }

    return () => {
      if (ttsAudioPlayer) {
        ttsAudioPlayer.removeEventListener('ended', handleTtsEnded);
        ttsAudioPlayer.removeEventListener('playing', handlePlaying);
        ttsAudioPlayer.removeEventListener('error', handleError);
      }
      mediaPlayers.forEach(player => {
        player?.removeEventListener('ended', () => { if(onPlaybackEndRef.current) onPlaybackEndRef.current() });
        player?.removeEventListener('playing', handlePlaying);
        player?.removeEventListener('loadedmetadata', handleLoadedMetadata);
        player?.removeEventListener('timeupdate', handleTimeUpdate);
        player?.removeEventListener('error', handleError);
    });
      
      if (typeof navigator !== 'undefined' && navigator.mediaSession) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('stop', null);
      }
    };
  }, [toast, stop, hasNext, hasPrevious, videoPlayer, resume, pause, next, previous, speakNextSegment]);

  const value: PlaybackContextType = {
    isPlaying,
    isPaused,
    isLoading,
    currentItem,
    playlist,
    currentText,
    play,
    pause,
    resume,
    stop,
    next,
    previous,
    hasNext,
    hasPrevious,
    playbackMode,
    setPlaybackMode,
    originalTextTtsSettings,
    setOriginalTextTtsSettings,
    yourNoteTtsSettings,
    setYourNoteTtsSettings,
    audioPlayerRef: audioPlayerRef as React.RefObject<HTMLAudioElement>,
    setVideoPlayerRef: setVideoPlayer,
    progress,
    duration,
    handleSeek,
    videoAspectRatio,
  };

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
};
