"use client";

import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Play, Trash2, Loader2, Pause, Smartphone, Cloud as CloudIcon, Info, Star, Repeat1, ListOrdered, SkipBack, SkipForward, Settings, ChevronLeft, ChevronRight, FileText, BookOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as LocalStorage from '@/lib/localStorageService';
import { documentExists } from '@/lib/indexedDBService';
import { fetchFavoriteItems, deleteFavoriteItemRemote } from '@/lib/authService';
import type { FavoriteItem, TTSVoice, PlaybackMode } from '@/types';
import { format } from 'date-fns';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { edgeTTSLanguageVoices } from '@/lib/edge-tts-voices';
import { cn } from '@/lib/utils';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { usePlayback } from '@/components/player/PlaybackProvider';
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
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

const ITEMS_PER_PAGE = 5;

// Helper to group voices by language
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

function FavoritesPageContent() {
  const { toast } = useToast();
  const router = useRouter();
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [itemToDelete, setItemToDelete] = useState<FavoriteItem | null>(null);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [jumpingItemId, setJumpingItemId] = useState<string | null>(null);

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
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
    originalTextTtsSettings: ttsSettings,
    setOriginalTextTtsSettings: setTtsSettings,
    hasNext,
    hasPrevious
  } = usePlayback();

  const paginatedItems = favoriteItems.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );
  const totalPages = Math.max(1, Math.ceil(favoriteItems.length / ITEMS_PER_PAGE));

  // Load initial settings and favorite items
  useEffect(() => {
    fetchFavoriteItems().then(setFavoriteItems);
    setPlaybackMode(LocalStorage.loadFavoritesPlaybackMode());

    const loadedSettings = LocalStorage.loadTTSSettings();
    setTtsSettings(prevGlobalDefaults => {
        const merged = {
            ...prevGlobalDefaults,
            ...loadedSettings,
            type: loadedSettings.type || 'local',
            engine: loadedSettings.engine || loadedSettings.type || 'local',
        };
        if (merged.engine === 'cloud' && (!merged.language || !merged.cloudVoiceId)) {
            const defaultLocale = 'en-US';
            merged.language = defaultLocale;
            if (edgeTTSLanguageVoices[defaultLocale]?.voices.length > 0) {
              merged.cloudVoiceId = edgeTTSLanguageVoices[defaultLocale].voices[0].id;
            }
        }
        return merged;
    });
  }, [setPlaybackMode, setTtsSettings]);

  // Save TTS settings to LocalStorage whenever they change
  useEffect(() => {
    LocalStorage.saveTTSSettings(ttsSettings);
  }, [ttsSettings]);
  
  useEffect(() => {
    LocalStorage.saveFavoritesPlaybackMode(playbackMode);
  }, [playbackMode]);
  
  const handlePlayPauseFavorite = (item: FavoriteItem) => {
    if (currentItem?.item.id === item.id && currentItem?.type === 'favorite') {
        if (isPlaying && isPaused) {
            resume();
        } else if (isPlaying) {
            pause();
        }
    } else {
        const fullPlaylist = favoriteItems.map(fav => ({ type: 'favorite' as const, item: fav }));
        const startIndex = favoriteItems.findIndex(fav => fav.id === item.id);
        play({ type: 'favorite', item }, fullPlaylist, startIndex);
    }
  };

  // Jumps back to the exact spot in the reader this favorite was captured
  // from. Checks the source document still exists first (a lightweight
  // metadata-only check, not a full file download) so a deleted document
  // shows a clear message here instead of navigating into a broken reader
  // page.
  const handleJumpToSource = async (item: FavoriteItem) => {
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
      if (item.sourcePageNumber) params.set('page', String(item.sourcePageNumber));
      if (item.sourceEpubCfi) params.set('cfi', item.sourceEpubCfi);
      if (item.sourceChapterIndex !== undefined) params.set('chapter', String(item.sourceChapterIndex));
      router.push(`/reader?${params.toString()}`);
    } finally {
      setJumpingItemId(null);
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

  // Effect to select/update default voice based on language for LOCAL engine
  useEffect(() => {
    if (ttsSettings.engine !== 'local' || availableVoices.length === 0) return;

    let desiredVoiceURI: string | undefined = ttsSettings.voiceURI;
    let desiredLanguage: string = ttsSettings.language;
    let settingsNeedUpdate = false;

    const currentVoice = availableVoices.find(v => v.voiceURI === ttsSettings.voiceURI);

    if (!currentVoice) {
      const defaultVoice =
          availableVoices.find((v) => v.lang === desiredLanguage && v.default) ||
          availableVoices.find((v) => v.lang === desiredLanguage) ||
          availableVoices.find((v) => v.default && v.lang) ||
          availableVoices[0];

      if (defaultVoice && defaultVoice.lang) {
          desiredVoiceURI = defaultVoice.voiceURI;
          desiredLanguage = defaultVoice.lang;
          settingsNeedUpdate = true;
      }
    }

    if (settingsNeedUpdate) {
        setTtsSettings(prevSettings => ({
            ...prevSettings,
            voiceURI: desiredVoiceURI,
            language: desiredLanguage,
        }));
    }
  }, [availableVoices, ttsSettings.language, ttsSettings.voiceURI, ttsSettings.engine, setTtsSettings]);
  
  const performDelete = async () => {
    if (!itemToDelete) return;
    if (currentItem?.item.id === itemToDelete.id) stop();
    const deletedId = itemToDelete.id;
    // Optimistic update - reflect the removal immediately, then reconcile
    // with the server (which is the source of truth across devices).
    setFavoriteItems(prev => prev.filter(item => item.id !== deletedId));
    if (paginatedItems.length === 1 && currentPage > 1) {
        setCurrentPage(currentPage - 1);
    }
    toast({ title: favDict.favoriteRemoved });
    setItemToDelete(null);
    await deleteFavoriteItemRemote(deletedId);
  };
  
  const handleSettingChange = (key: any, value: any) => {
    stop();
    setTtsSettings(prevSettings => {
        let newSettings:any = { ...prevSettings, [key]: value };

        if (key === 'engine') {
            if (value === 'cloud') {
                const currentLang = newSettings.language;
                const cloudLangData = edgeTTSLanguageVoices[currentLang];
                if (!cloudLangData) {
                    const defaultLocale = 'en-US';
                    newSettings.language = defaultLocale;
                    newSettings.cloudVoiceId = edgeTTSLanguageVoices[defaultLocale].voices[0].id;
                } else if (!newSettings.cloudVoiceId?.startsWith(currentLang)) {
                    newSettings.cloudVoiceId = cloudLangData.voices[0].id;
                }
            } else if (value === 'local') {
                const currentVoice = availableVoices.find(v => v.voiceURI === newSettings.voiceURI);
                if (!currentVoice) {
                    const defaultVoice = availableVoices.find(v => v.default) || availableVoices[0];
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
    } else if (favoriteItems.length > 0) {
      handlePlayPauseFavorite(favoriteItems[0]);
    }
  };

  const groupedLocalVoices = groupVoicesByLanguage(availableVoices);

  return (
    <>
      <div className="container mx-auto p-2 md:p-6 space-y-4">
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Star className="text-primary h-6 w-6" />
                <div>
                  <CardTitle>{favDict.title}</CardTitle>
                  <CardDescription>{favDict.description}</CardDescription>
                </div>
              </div>
               <Sheet>
                    <SheetTrigger asChild>
                        <Button variant="outline" size="icon">
                            <Settings className="h-5 w-5" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent>
                        <SheetHeader>
                            <SheetTitle>{favDict.globalSettingsTitle}</SheetTitle>
                        </SheetHeader>
                        <div className="py-4 space-y-4">
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                              <div>
                                  <Label htmlFor="fav-tts-engine">{favDict.ttsEngine}</Label>
                                  <Select value={ttsSettings.engine} onValueChange={(v) => handleSettingChange('engine', v as 'local' | 'cloud')} disabled={isPlaying && !isPaused}>
                                      <SelectTrigger id="fav-tts-engine"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                      <SelectItem value="local"><div className="flex items-center gap-1"><Smartphone className="h-4 w-4" />{favDict.localEngine}</div></SelectItem>
                                      <SelectItem value="cloud"><div className="flex items-center gap-1"><CloudIcon className="h-4 w-4"/>{favDict.cloudEngine}</div></SelectItem>
                                      </SelectContent>
                                  </Select>
                              </div>
                          </div>
                           {ttsSettings.engine === 'local' && (
                              <div className="mb-3">
                                  <Label htmlFor="fav-tts-voice">{favDict.voiceLocal}</Label>
                                  <Select
                                      value={ttsSettings.voiceURI || ""}
                                      onValueChange={(v) => handleSettingChange('voiceURI', v)}
                                      disabled={(isPlaying && !isPaused) || availableVoices.length === 0}
                                  >
                                      <SelectTrigger id="fav-tts-voice"><SelectValue placeholder={availableVoices.length > 0 ? favDict.selectVoice : favDict.noLocalVoices} /></SelectTrigger>
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

                          {ttsSettings.engine === 'cloud' && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                                  <div>
                                      <Label htmlFor="fav-cloud-tts-language">{favDict.languageCloud}</Label>
                                      <Select value={ttsSettings.language} onValueChange={(v) => handleSettingChange('language', v as string)} disabled={isPlaying && !isPaused}>
                                          <SelectTrigger id="fav-cloud-tts-language"><SelectValue placeholder={favDict.selectLanguage} /></SelectTrigger>
                                          <SelectContent className="max-h-60">
                                              {Object.entries(edgeTTSLanguageVoices).map(([locale, { language }]) => (
                                                  <SelectItem key={locale} value={locale}>{language} ({locale})</SelectItem>
                                              ))}
                                          </SelectContent>
                                      </Select>
                                  </div>
                                  <div>
                                      <Label htmlFor="fav-cloud-tts-voice">{favDict.voiceCloud}</Label>
                                      <Select value={ttsSettings.cloudVoiceId || ""} onValueChange={(v) => handleSettingChange('cloudVoiceId', v)} disabled={(isPlaying && !isPaused) || !ttsSettings.language}>
                                          <SelectTrigger id="fav-cloud-tts-voice"><SelectValue placeholder={favDict.selectVoice} /></SelectTrigger>
                                          <SelectContent className="max-h-60">
                                              {(edgeTTSLanguageVoices[ttsSettings.language]?.voices || []).map(voice => (
                                                  <SelectItem key={voice.id} value={voice.id}>{voice.name}</SelectItem>
                                              ))}
                                          </SelectContent>
                                      </Select>
                                  </div>
                              </div>
                          )}
                          <div className="space-y-2 mb-3">
                              <Label htmlFor="fav-tts-rate">{commonDict.rate}: {ttsSettings.rate.toFixed(1)}</Label>
                              <Slider id="fav-tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={isPlaying && !isPaused}/>
                          </div>
                          <div className="space-y-2">
                              <Label htmlFor="fav-tts-pitch">{commonDict.pitch}: {ttsSettings.pitch.toFixed(1)}</Label>
                              <Slider id="fav-tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={isPlaying && !isPaused}/>
                          </div>
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
                      <RadioGroupItem value="default" id="mode-default-fav" />
                      <Label htmlFor="mode-default-fav" className="flex items-center gap-1 cursor-pointer"><Play className="h-4 w-4"/>{commonDict.default}</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="loop-single" id="mode-loop-fav" />
                      <Label htmlFor="mode-loop-fav" className="flex items-center gap-1 cursor-pointer"><Repeat1 className="h-4 w-4"/>{favDict.loopSingle}</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="sequential" id="mode-sequential-fav" />
                      <Label htmlFor="mode-sequential-fav" className="flex items-center gap-1 cursor-pointer"><ListOrdered className="h-4 w-4"/>{favDict.listLoopMode}</Label>
                    </div>
                  </RadioGroup>
              </div>
              <div className="flex items-center justify-center gap-4 p-2 rounded-lg bg-background/50">
                <Button variant="ghost" size="icon" onClick={previous} disabled={!hasPrevious() || isLoading}><SkipBack className="h-5 w-5"/></Button>
                <Button variant="ghost" size="icon" onClick={handleGlobalPlayPause} disabled={isLoading || favoriteItems.length === 0}>
                    {isLoading ? <Loader2 className="h-6 w-6 animate-spin"/> : isPlaying && !isPaused ? <Pause className="h-6 w-6"/> : <Play className="h-6 w-6"/>}
                </Button>
                <Button variant="ghost" size="icon" onClick={next} disabled={!hasNext() || isLoading}><SkipForward className="h-5 w-5"/></Button>
              </div>
            </div>

            {favoriteItems.length === 0 ? (
              <p className="text-center text-muted-foreground flex items-center justify-center gap-2 py-8"><Info className="h-5 w-5" />{favDict.emptyList}</p>
            ) : (
              <ul className="space-y-2 mt-4">
                {paginatedItems.map(item => {
                  const isCurrentlyPlaying = currentItem?.item.id === item.id && currentItem?.type === 'favorite';
                  let buttonIcon = <Play className="h-4 w-4" />;
                  let buttonText = commonDict.play;
                  if (isCurrentlyPlaying) {
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

                  return (
                    <li key={item.id} className="p-3 border rounded-md flex flex-col justify-between gap-2 bg-card hover:shadow-md transition-shadow">
                        <div className="flex-grow space-y-2">
                            <p className="text-base font-medium whitespace-pre-wrap">
                            {isCurrentlyPlaying && currentText ? 
                                <span className="text-green-600">{`“${currentText}”`}</span>
                                : 
                                `"${item.text}"`
                            }
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between pt-2 border-t mt-2">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
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
                                {favDict.added}: {format(new Date(item.createdAt), "MMM d, yyyy")}
                                </p>
                            </div>

                            <div className="flex gap-2 self-end sm:self-center flex-shrink-0">
                                <Button 
                                size="sm" 
                                variant={isCurrentlyPlaying && !isPaused ? "outline" : "default"}
                                onClick={() => handlePlayPauseFavorite(item)} 
                                disabled={isLoading && !isCurrentlyPlaying}
                                className="w-[80px] h-8 text-xs"
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
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setItemToDelete(item)} disabled={isLoading && isCurrentlyPlaying} aria-label="Delete Favorite">
                                <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
          {favoriteItems.length > ITEMS_PER_PAGE && (
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
          {favoriteItems.length > 0 && (
            <CardFooter>
              <p className="text-xs text-muted-foreground">{favDict.storageNote}</p>
            </CardFooter>
          )}
        </Card>
      </div>
      <AlertDialog open={!!itemToDelete} onOpenChange={(isOpen) => !isOpen && setItemToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{commonDict.areYouSure}</AlertDialogTitle>
            <AlertDialogDescription>
              {commonDict.actionCannotBeUndone} {favDict.deleteConfirmation}
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

export default function FavoritesPage() {
    return (
        <AuthGuard>
            <FavoritesPageContent />
        </AuthGuard>
    );
}
