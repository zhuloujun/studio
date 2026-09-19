"use client";

import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Trash2, Info, NotebookText, FileText, Play, Pause, Loader2, Smartphone, Cloud as CloudIcon, Star, Repeat1, ListOrdered, SkipBack, SkipForward, Settings, ChevronLeft, ChevronRight, Pencil, BookOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as LocalStorage from '@/lib/localStorageService';
import { documentExists } from '@/lib/indexedDBService';
import { fetchNoteFavorites, deleteNoteFavoriteRemote } from '@/lib/authService';
import type { NoteFavoriteItem, TTSVoice, TTSSettings, PlaybackMode } from '@/types';
import { format } from 'date-fns';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { getCloudSpeech } from '@/app/actions';
import { edgeTTSLanguageVoices } from '@/lib/edge-tts-voices';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { usePlayback } from '@/components/player/PlaybackProvider';
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

const ITEMS_PER_PAGE = 5;

const groupVoicesByLanguage = (voices: TTSVoice[]) => {
  return voices.reduce((acc, voice) => {
    const lang = voice.lang || 'Unknown';
    if (!acc[lang]) {
      acc[lang] = [];
    }
    acc[lang].push(voice);
    return acc;
  }, {} as Record<string, TTSVoice[]>);
};

const HighlightableText: React.FC<{
  text: string;
  isSpeaking: boolean;
  highlightedText: string;
  noTextContent: string;
}> = ({ text, isSpeaking, highlightedText, noTextContent }) => {
    if (!text) {
        return <>{noTextContent}</>;
    }
    if (!isSpeaking || !highlightedText || !text.includes(highlightedText)) {
        return <>{`"${text}"`}</>;
    }

    const index = text.indexOf(highlightedText);
    const preText = text.substring(0, index);
    const postText = text.substring(index + highlightedText.length);

    return (
        <>
        &quot;{preText}
        <span className="text-green-600">{highlightedText}</span>
        {postText}&quot;
        </>
    );
};


function NotesFavoritesPageContent() {
  const { toast } = useToast();
  const router = useRouter();
  const [favoriteNotes, setFavoriteNotes] = useState<NoteFavoriteItem[]>([]);
  const [noteToDelete, setNoteToDelete] = useState<NoteFavoriteItem | null>(null);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [jumpingItemId, setJumpingItemId] = useState<string | null>(null);

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const notesFavDict = dictionary.notesFavorites;
  const favDict = dictionary.favorites;
  const mediaDict = dictionary.media;

  const {
    play,
    stop,
    pause,
    resume,
    next,
    previous,
    isPlaying,
    isPaused,
    isLoading,
    currentItem,
    currentText,
    playlist,
    playbackMode,
    setPlaybackMode,
    originalTextTtsSettings,
    setOriginalTextTtsSettings,
    yourNoteTtsSettings,
    setYourNoteTtsSettings,
    hasNext,
    hasPrevious,
  } = usePlayback();
  
  const paginatedItems = favoriteNotes.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );
  const totalPages = Math.max(1, Math.ceil(favoriteNotes.length / ITEMS_PER_PAGE));


  // Load initial settings and favorite items
  useEffect(() => {
    fetchNoteFavorites().then(setFavoriteNotes);
    setPlaybackMode(LocalStorage.loadNotesPlaybackMode());

    const loadAndSetSettings = (loader: () => TTSSettings, setter: React.Dispatch<React.SetStateAction<TTSSettings>>) => {
        const loadedSettings = loader();
        const merged = {
            ...LocalStorage.defaultTTSSettings,
            ...loadedSettings,
            engine: loadedSettings.engine || loadedSettings.type || 'local',
        };
        if (merged.engine === 'cloud' && (!merged.language || !merged.cloudVoiceId)) {
            const defaultLocale = 'en-US';
            merged.language = defaultLocale;
            if (edgeTTSLanguageVoices[defaultLocale].voices.length > 0) {
              merged.cloudVoiceId = edgeTTSLanguageVoices[defaultLocale].voices[0].id;
            }
        }
        setter(merged);
    };

    loadAndSetSettings(LocalStorage.loadOriginalTextTTSSettings, setOriginalTextTtsSettings);
    loadAndSetSettings(LocalStorage.loadYourNoteTTSSettings, setYourNoteTtsSettings);
  }, [setPlaybackMode, setOriginalTextTtsSettings, setYourNoteTtsSettings]);

  // Save TTS settings to LocalStorage whenever they change
  useEffect(() => {
    LocalStorage.saveOriginalTextTTSSettings(originalTextTtsSettings);
  }, [originalTextTtsSettings]);
  useEffect(() => {
    LocalStorage.saveYourNoteTTSSettings(yourNoteTtsSettings);
  }, [yourNoteTtsSettings]);
  useEffect(() => {
      LocalStorage.saveNotesPlaybackMode(playbackMode);
  }, [playbackMode]);


  // Jumps back to the exact spot in the reader this note was captured from.
  // Checks the source document still exists first (a lightweight
  // metadata-only check, not a full file download) so a deleted document
  // shows a clear message here instead of navigating into a broken reader
  // page. The annotation's pageNumber means different things per document
  // type (PDF/EPUB page vs. MOBI chapter index) and this list doesn't track
  // which type the source document is, so it's passed as both `page` and
  // `chapter` - the reader only reads whichever one is actually relevant to
  // the document it opens.
  const handleJumpToSource = async (item: NoteFavoriteItem) => {
    if (!item.sourceDocumentId || item.sourceDocumentId === 'scratchpad') {
      router.push('/reader');
      return;
    }
    setJumpingItemId(item.id);
    try {
      const exists = await documentExists(item.sourceDocumentId);
      if (!exists) {
        toast({ variant: 'destructive', title: '原文献已被删除', description: '无法跳转，原文献已经被删除。' });
        return;
      }
      const params = new URLSearchParams({ docId: item.sourceDocumentId });
      if (item.annotation.pageNumber !== undefined) {
        params.set('page', String(item.annotation.pageNumber));
        params.set('chapter', String(item.annotation.pageNumber));
      }
      if (item.annotation.epubCfi) params.set('cfi', item.annotation.epubCfi);
      router.push(`/reader?${params.toString()}`);
    } finally {
      setJumpingItemId(null);
    }
  };

  const handlePlayPauseNote = (item: NoteFavoriteItem) => {
    if (currentItem?.item.id === item.id && currentItem?.type === 'note_favorite') {
        if (isPlaying && isPaused) {
            resume();
        } else if (isPlaying) {
            pause();
        }
    } else {
        const fullPlaylist = favoriteNotes.map(note => ({ type: 'note_favorite' as const, item: note }));
        const startIndex = favoriteNotes.findIndex(note => note.id === item.id);
        play({ type: 'note_favorite', item }, fullPlaylist, startIndex);
    }
  };
  
  const populateVoiceList = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const voices = window.speechSynthesis.getVoices().map(v => ({
        name: v.name,
        lang: v.lang,
        voiceURI: v.voiceURI,
        localService: v.localService,
        default: v.default,
      }));
      setAvailableVoices(voices);
    }
  }, []);

  useEffect(() => {
    populateVoiceList();
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = populateVoiceList;
    }
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [populateVoiceList]);

  const performDelete = async () => {
    if (!noteToDelete) return;
    if (currentItem?.item.id === noteToDelete.id) stop();
    const deletedId = noteToDelete.id;
    setFavoriteNotes(prev => prev.filter(item => item.id !== deletedId));
    if (paginatedItems.length === 1 && currentPage > 1) {
        setCurrentPage(currentPage - 1);
    }
    toast({ title: notesFavDict.noteFavoriteRemoved });
    setNoteToDelete(null);
    await deleteNoteFavoriteRemote(deletedId);
  };
  
  const handleSettingChange = (
      panel: 'original' | 'note',
      key: keyof TTSSettings,
      value: any
  ) => {
      stop();
      const setter = panel === 'original' ? setOriginalTextTtsSettings : setYourNoteTtsSettings;
  
      setter(prevSettings => {
          let newSettings = { ...prevSettings, [key]: value };
  
          if (key === 'engine') {
              newSettings.type = value as 'local' | 'cloud';
              if (value === 'cloud') {
                  const currentLang = newSettings.language;
                  const cloudLangData = edgeTTSLanguageVoices[currentLang];
                  if (!cloudLangData || !cloudLangData.voices.length) {
                      const defaultLocale = 'en-US';
                      newSettings.language = defaultLocale;
                      newSettings.cloudVoiceId = edgeTTSLanguageVoices[defaultLocale].voices[0].id;
                  } else if (!newSettings.cloudVoiceId?.startsWith(currentLang)) {
                      newSettings.cloudVoiceId = cloudLangData.voices[0].id;
                  }
              } else if (value === 'local') {
                  const currentVoice = availableVoices.find(v => v.voiceURI === newSettings.voiceURI);
                  if (!currentVoice) {
                      const defaultVoice = availableVoices.find(v => v.default && v.lang) || availableVoices[0];
                      if (defaultVoice) {
                          newSettings.voiceURI = defaultVoice.voiceURI;
                          newSettings.language = defaultVoice.lang;
                      }
                  }
              }
          }
  
          if (key === 'language' && newSettings.engine === 'cloud') {
              const newLang = value as string;
              const langVoices = edgeTTSLanguageVoices[newLang]?.voices;
              if (langVoices && langVoices.length > 0) {
                  newSettings.cloudVoiceId = langVoices[0].id;
              } else {
                  newSettings.cloudVoiceId = undefined;
              }
          }
  
          if (key === 'voiceURI' && newSettings.engine === 'local' && value) {
              const selectedVoice = availableVoices.find(v => v.voiceURI === value);
              if (selectedVoice) {
                  newSettings.language = selectedVoice.lang;
              }
          }
          
          return newSettings;
      });
  };

  const handleGlobalPlayPause = () => {
    if (isPlaying) {
      if (isPaused) {
        resume();
      } else {
        pause();
      }
    } else if (playlist.length > 0) {
        play(playlist[0], playlist, 0);
    } else if (favoriteNotes.length > 0) {
      handlePlayPauseNote(favoriteNotes[0]);
    }
  };

  const groupedLocalVoices = groupVoicesByLanguage(availableVoices);

  const renderTtsPanel = (
    panelType: 'original' | 'note',
    title: string,
    settings: TTSSettings,
  ) => {
    const handlePanelChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
      handleSettingChange(panelType, key, value);
    };

    return (
      <div className="mb-4">
        <h3 className="text-lg font-medium mb-3">{title}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
            <div>
                <Label htmlFor={`${panelType}-tts-engine`}>{favDict.ttsEngine}</Label>
                <Select value={settings.engine} onValueChange={(v) => handlePanelChange('engine', v as 'local' | 'cloud')} disabled={isPlaying && !isPaused}>
                    <SelectTrigger id={`${panelType}-tts-engine`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local"><div className="flex items-center gap-1"><Smartphone className="h-4 w-4" />{favDict.localEngine}</div></SelectItem>
                      <SelectItem value="cloud"><div className="flex items-center gap-1"><CloudIcon className="h-4 w-4"/>{favDict.cloudEngine}</div></SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>

        {settings.engine === 'local' && (
            <div className="mb-3">
                <Label htmlFor={`${panelType}-tts-voice`}>{favDict.voiceLocal}</Label>
                <Select
                    value={settings.voiceURI || ""}
                    onValueChange={(v) => handlePanelChange('voiceURI', v)}
                    disabled={(isPlaying && !isPaused) || availableVoices.length === 0}
                >
                    <SelectTrigger id={`${panelType}-tts-voice`}><SelectValue placeholder={availableVoices.length > 0 ? favDict.selectVoice : favDict.noLocalVoices} /></SelectTrigger>
                    <SelectContent className="max-h-60">
                        {availableVoices.length === 0 ? (
                            <SelectItem value="no-voices" disabled>{favDict.noLocalVoices}</SelectItem>
                        ) : (
                            Object.entries(groupedLocalVoices).map(([lang, voices]) => (
                                <SelectGroup key={lang}>
                                    <SelectLabel>{lang}</SelectLabel>
                                    {voices.map(voice => (
                                        <SelectItem key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</SelectItem>
                                    ))}
                                </SelectGroup>
                            ))
                        )}
                    </SelectContent>
                </Select>
            </div>
        )}

        {settings.engine === 'cloud' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                <div>
                    <Label htmlFor={`${panelType}-cloud-tts-language`}>{favDict.languageCloud}</Label>
                    <Select value={settings.language} onValueChange={(v) => handlePanelChange('language', v as string)} disabled={isPlaying && !isPaused}>
                        <SelectTrigger id={`${panelType}-cloud-tts-language`}><SelectValue placeholder={favDict.selectLanguage} /></SelectTrigger>
                        <SelectContent className="max-h-60">
                            {Object.entries(edgeTTSLanguageVoices).map(([locale, { language }]) => (
                                <SelectItem key={locale} value={locale}>{language} ({locale})</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label htmlFor={`${panelType}-cloud-tts-voice`}>{favDict.voiceCloud}</Label>
                    <Select value={settings.cloudVoiceId || ""} onValueChange={(v) => handlePanelChange('cloudVoiceId', v)} disabled={(isPlaying && !isPaused) || !settings.language}>
                        <SelectTrigger id={`${panelType}-cloud-tts-voice`}><SelectValue placeholder={favDict.selectVoice} /></SelectTrigger>
                        <SelectContent className="max-h-60">
                            {(edgeTTSLanguageVoices[settings.language]?.voices || []).map(voice => (
                                <SelectItem key={voice.id} value={voice.id}>{voice.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        )}

        <div className="space-y-2 mb-3">
            <Label htmlFor={`${panelType}-tts-rate`}>{commonDict.rate}: {settings.rate.toFixed(1)}</Label>
            <Slider id={`${panelType}-tts-rate`} min={0.5} max={2} step={0.1} value={[settings.rate]} onValueChange={([v]) => handlePanelChange('rate', v)} disabled={isPlaying && !isPaused}/>
        </div>
        <div className="space-y-2">
            <Label htmlFor={`${panelType}-tts-pitch`}>{commonDict.pitch}: {settings.pitch.toFixed(1)}</Label>
            <Slider id={`${panelType}-tts-pitch`} min={0} max={2} step={0.1} value={[settings.pitch]} onValueChange={([v]) => handlePanelChange('pitch', v)} disabled={isPlaying && !isPaused}/>
        </div>
      </div>
    );
  };


  return (
    <>
      <div className="container mx-auto p-2 md:p-6 space-y-4">
        <Card>
          <CardHeader>
             <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <NotebookText className="text-primary h-6 w-6" />
                    <div>
                        <CardTitle>{notesFavDict.title}</CardTitle>
                        <CardDescription>{notesFavDict.description}</CardDescription>
                    </div>
                </div>
                <Sheet>
                    <SheetTrigger asChild>
                        <Button variant="outline" size="icon">
                            <Settings className="h-5 w-5" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent className="overflow-y-auto">
                        <SheetHeader>
                            <SheetTitle>{favDict.globalSettingsTitle}</SheetTitle>
                        </SheetHeader>
                        <div className="py-4 space-y-4">
                            <Separator className="my-6" />
                            {renderTtsPanel('original', notesFavDict.originalTextSettings, originalTextTtsSettings)}
                            <Separator className="my-6" />
                            {renderTtsPanel('note', notesFavDict.yourNoteSettings, yourNoteTtsSettings)}
                        </div>
                    </SheetContent>
                </Sheet>
             </div>
          </CardHeader>
          <CardContent>
            <div className="p-4 border rounded-md bg-muted/20 space-y-4">
              <h3 className="text-lg font-medium">{mediaDict.playbackControls}</h3>
              <div>
                  <Label className="font-medium text-sm">{mediaDict.playbackMode}</Label>
                  <RadioGroup
                    value={playbackMode}
                    onValueChange={(v) => {
                      setPlaybackMode(v as PlaybackMode);
                    }}
                    className="flex items-center gap-4 mt-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="default" id="mode-default-notes" />
                      <Label htmlFor="mode-default-notes" className="flex items-center gap-1 cursor-pointer"><Play className="h-4 w-4"/>{commonDict.default}</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="loop-single" id="mode-loop-notes" />
                      <Label htmlFor="mode-loop-notes" className="flex items-center gap-1 cursor-pointer"><Repeat1 className="h-4 w-4"/>{notesFavDict.loopSingle}</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="sequential" id="mode-sequential-notes" />
                      <Label htmlFor="mode-sequential-notes" className="flex items-center gap-1 cursor-pointer"><ListOrdered className="h-4 w-4"/>{notesFavDict.listLoopMode}</Label>
                    </div>
                  </RadioGroup>
              </div>
              <div className="flex items-center justify-center gap-4 p-2 rounded-lg bg-background/50">
                  <Button variant="ghost" size="icon" onClick={previous} disabled={!hasPrevious() || isLoading}><SkipBack className="h-5 w-5"/></Button>
                  <Button variant="ghost" size="icon" onClick={handleGlobalPlayPause} disabled={isLoading || favoriteNotes.length === 0}>
                  {isLoading ? <Loader2 className="h-6 w-6 animate-spin"/> : isPlaying && !isPaused ? <Pause className="h-6 w-6"/> : <Play className="h-6 w-6"/>}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={next} disabled={!hasNext() || isLoading}><SkipForward className="h-5 w-5"/></Button>
              </div>
            </div>
            
            {favoriteNotes.length === 0 ? (
              <p className="text-center text-muted-foreground flex items-center justify-center gap-2 py-8"><Info className="h-5 w-5" />{notesFavDict.emptyList}</p>
            ) : (
              <ul className="space-y-3 mt-4">
                {paginatedItems.map(item => {
                  const isCurrentlyPlayingThisItem = currentItem?.item.id === item.id;
                  let buttonIcon = <Play className="h-4 w-4" />;
                  let buttonText = commonDict.play;
                  if (isCurrentlyPlayingThisItem) {
                      if (isLoading) {
                          buttonIcon = <Loader2 className="h-4 w-4 animate-spin" />;
                          buttonText = commonDict.loading;
                      } else if (isPaused) {
                          buttonIcon = <Play className="h-4 w-4" />;
                          buttonText = commonDict.resume;
                      } else {
                          buttonIcon = <Pause className="h-4 w-4" />;
                          buttonText = commonDict.pause;
                      }
                  }
                  const hasContentToPlay = item.annotation.targetText || item.annotation.note;

                  const isHighlightingTarget = isCurrentlyPlayingThisItem && currentItem?.part === 'original';
                  const isHighlightingNote = isCurrentlyPlayingThisItem && currentItem?.part === 'note';

                  return (
                    <li key={item.id} className="p-2 border rounded-md flex flex-col justify-between gap-2 bg-card hover:shadow-md transition-shadow">
                        <div className="flex-grow space-y-2 w-full">
                            <div className="p-2 bg-muted/50 rounded-md">
                                <div className="flex items-start gap-2">
                                    <FileText className="h-4 w-4 mt-1 flex-shrink-0 text-muted-foreground" />
                                    <p className={cn("text-base font-medium italic", !item.annotation.targetText && "text-muted-foreground")}>
                                    <HighlightableText
                                        text={item.annotation.targetText || ''}
                                        isSpeaking={isHighlightingTarget}
                                        highlightedText={currentText}
                                        noTextContent={notesFavDict.noTextAvailable}
                                    />
                                    </p>
                                </div>
                            </div>

                            <div className="p-2 bg-background rounded-md border">
                                <div className="flex items-start gap-2">
                                    <Pencil className="h-4 w-4 mt-1 flex-shrink-0 text-muted-foreground" />
                                    <p className={cn("text-base font-medium whitespace-pre-wrap", !item.annotation.note && "italic text-muted-foreground")}>
                                    <HighlightableText
                                        text={item.annotation.note || ''}
                                        isSpeaking={isHighlightingNote}
                                        highlightedText={currentText}
                                        noTextContent={notesFavDict.noTextAvailable}
                                    />
                                    </p>
                                </div>
                            </div>
                        
                            {item.annotation.imageDataUrl && (
                                <div className="p-2 border rounded-md">
                                    <p className="text-xs text-muted-foreground mb-1">{notesFavDict.attachedImage}</p>
                                    <div className="relative w-full max-w-[200px]">
                                        <NextImage src={item.annotation.imageDataUrl} alt="Annotation attachment" width={200} height={150} className="rounded-md object-contain" />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between pt-2 border-t mt-2">
                            <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                                {item.sourceDocumentName && (
                                    <>
                                        <FileText className="h-3 w-3 flex-shrink-0" />
                                        <p className="truncate" title={item.sourceDocumentName}>
                                            {item.sourceDocumentName}
                                        </p>
                                        <span className="mx-1">|</span>
                                    </>
                                )}
                                <p className="flex-shrink-0">
                                    {notesFavDict.favorited}: {format(new Date(item.favoritedAt), "MMM d, yyyy")}
                                </p>
                            </div>
                            <div className="flex gap-2 self-end sm:self-center">
                            <Button 
                                size="sm" 
                                variant={isCurrentlyPlayingThisItem && !isPaused ? "outline" : "default"}
                                onClick={() => handlePlayPauseNote(item)} 
                                disabled={(isLoading && !isCurrentlyPlayingThisItem) || !hasContentToPlay}
                                className="w-[80px] h-8 text-xs"
                                title={hasContentToPlay ? notesFavDict.playPauseNote : notesFavDict.noTextToPlay}
                                >
                                {buttonIcon} {buttonText}
                            </Button>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => handleJumpToSource(item)}
                                disabled={jumpingItemId === item.id}
                                aria-label="Jump to source in reader"
                                title="跳转回原文献位置"
                                >
                                {jumpingItemId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setNoteToDelete(item)} aria-label="Delete Note Favorite" disabled={isLoading && isCurrentlyPlayingThisItem}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                            </div>
                        </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
          {favoriteNotes.length > ITEMS_PER_PAGE && (
              <CardFooter className="flex justify-center items-center gap-2">
                  <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => p - 1)}
                      disabled={currentPage === 1}
                  >
                      <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                      {commonDict.page} {currentPage} / {totalPages}
                  </span>
                  <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => p + 1)}
                      disabled={currentPage === totalPages}
                  >
                      <ChevronRight className="h-4 w-4" />
                  </Button>
              </CardFooter>
          )}
          {favoriteNotes.length > 0 && (
            <CardFooter>
              <p className="text-xs text-muted-foreground">{notesFavDict.storageNote}</p>
            </CardFooter>
          )}
        </Card>
      </div>
      
      <AlertDialog open={!!noteToDelete} onOpenChange={(isOpen) => !isOpen && setNoteToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{commonDict.areYouSure}</AlertDialogTitle>
            <AlertDialogDescription>
                {commonDict.actionCannotBeUndone} {notesFavDict.deleteConfirmation}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{commonDict.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete}>{commonDict.continue}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function NotesFavoritesPage() {
    return (
        <AuthGuard>
            <NotesFavoritesPageContent />
        </AuthGuard>
    );
}
