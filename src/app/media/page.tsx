
"use client";

import { useState, useEffect, useRef, useContext } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud, Info, Trash2, Loader2, Music, Video, MessageSquare, Play, Pause, Repeat1, ListOrdered, SkipBack, SkipForward } from 'lucide-react';
import * as IndexedDBService from '@/lib/indexedDBService';
import * as LocalStorage from '@/lib/localStorageService';
import type { MediaFavoriteItem } from '@/types';
import { format } from 'date-fns';
import { AuthGuard } from '@/components/auth/AuthGuard';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { usePlayback } from '@/components/player/PlaybackProvider';
import { cn } from '@/lib/utils';
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';


function MediaFavoritesPageContent() {
  const { toast } = useToast();
  const [mediaItems, setMediaItems] = useState<MediaFavoriteItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  
  const [itemToDelete, setItemToDelete] = useState<MediaFavoriteItem | null>(null);
  
  const [uploadDialog, setUploadDialog] = useState<{
    file: File | null;
    note: string;
  }>({ file: null, note: '' });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRefs = useRef<Record<string, string>>({});

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const mediaDict = dictionary.media;

  const {
    play,
    pause,
    resume,
    stop,
    next,
    previous,
    isPlaying,
    isPaused,
    isLoading: isPlaybackLoading,
    currentItem,
    playlist,
    playbackMode,
    setPlaybackMode,
    hasNext,
    hasPrevious,
  } = usePlayback();


  useEffect(() => {
    fetchItems();
    setPlaybackMode(LocalStorage.loadMediaPlaybackMode());
    
    return () => {
      // Clean up object URLs on component unmount
      Object.values(objectUrlRefs.current).forEach(URL.revokeObjectURL);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  useEffect(() => {
      LocalStorage.saveMediaPlaybackMode(playbackMode);
  }, [playbackMode]);

  const fetchItems = async () => {
    setIsLoading(true);
    try {
        const items = await IndexedDBService.getAllMediaItems();
        setMediaItems(items);
    } catch (error: any) {
        toast({ variant: 'destructive', title: mediaDict.failedToLoad, description: error.message });
    } finally {
        setIsLoading(false);
    }
  };
  
  const handlePlayPause = (item: MediaFavoriteItem) => {
    const isCurrentlyPlayingThis = currentItem?.item.id === item.id;
  
    if (isCurrentlyPlayingThis) {
      if (isPaused) {
        resume();
      } else {
        pause();
      }
    } else {
      const fullPlaylist = mediaItems.map(media => ({ type: 'media_favorite' as const, item: media }));
      const startIndex = mediaItems.findIndex(media => media.id === item.id);
      play({ type: 'media_favorite', item }, fullPlaylist, startIndex);
    }
  };
  
  const handleGlobalPlayPause = () => {
    if (isPlaying && !isPaused) {
      pause();
    } else if (isPlaying && isPaused) {
      resume();
    } else if (mediaItems.length > 0) {
      handlePlayPause(mediaItems[0]);
    }
  };


  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
        setUploadDialog({ file, note: '' });
      } else {
        toast({
          variant: 'destructive',
          title: mediaDict.unsupportedFileType,
          description: mediaDict.unsupportedFileMessage,
        });
      }
    }
  };

  const handleUploadConfirm = async () => {
    if (!uploadDialog.file) return;
    setIsUploading(true);
    
    try {
      const fileBuffer = await uploadDialog.file.arrayBuffer();
      const newItem: MediaFavoriteItem = {
        id: `media_${Date.now()}`,
        name: uploadDialog.file.name,
        type: uploadDialog.file.type.startsWith('audio') ? 'audio' : 'video',
        fileData: fileBuffer,
        originalType: uploadDialog.file.type,
        note: uploadDialog.note,
        createdAt: Date.now(),
        sourceDocumentName: 'Local Upload'
      };

      await IndexedDBService.saveMediaItem(newItem);
      toast({ title: commonDict.success, description: mediaDict.itemAdded.replace('{name}', newItem.name) });
      await fetchItems(); // Refresh the list
      
    } catch (error: any) {
      toast({ variant: 'destructive', title: mediaDict.uploadFailed, description: mediaDict.uploadFailedMessage.replace('{message}', error.message) });
    } finally {
      // Reset dialog and input
      setUploadDialog({ file: null, note: '' });
      if (fileInputRef.current) fileInputRef.current.value = "";
      setIsUploading(false);
    }
  };

  const performDelete = async () => {
    if (!itemToDelete) return;
    if (currentItem?.item.id === itemToDelete.id) stop();
    await IndexedDBService.deleteMediaItemById(itemToDelete.id);
    toast({ title: commonDict.delete, description: mediaDict.itemDeleted.replace('{name}', itemToDelete.name) });
    setItemToDelete(null);
    await fetchItems();
  };
  
  const getMediaIcon = (type: 'audio' | 'video') => {
    return type === 'audio' 
      ? <Music className="h-6 w-6 text-primary flex-shrink-0" />
      : <Video className="h-6 w-6 text-primary flex-shrink-0" />;
  };

  // Function to create or get a playable URL for a media item.
  // Prefer the server-streamed fileUrl (works for any file size, supports
  // seeking) over building a Blob from in-memory fileData.
  const getObjectUrl = (item: MediaFavoriteItem): string => {
    if (item.fileUrl) return item.fileUrl;

    if (objectUrlRefs.current[item.id]) {
      return objectUrlRefs.current[item.id];
    }
    const blob = new Blob([item.fileData], { type: item.originalType });
    const url = URL.createObjectURL(blob);
    objectUrlRefs.current[item.id] = url;
    return url;
  };

  return (
    <>
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UploadCloud className="text-primary" />{mediaDict.uploadMediaTitle}
            </CardTitle>
            <CardDescription>
              {mediaDict.uploadMediaDescription}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
              {mediaDict.selectFile}
            </Button>
            <Input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={handleFileSelect}
            />
             {isUploading && <p className="mt-2 text-sm text-muted-foreground flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{mediaDict.processingAndSaving}</p>}
          </CardContent>
        </Card>

        <div className="p-4 border rounded-md bg-muted/20">
            <h3 className="text-lg font-medium mb-3">{mediaDict.playbackControls}</h3>
            <div className="mb-4">
                <Label className="font-medium text-sm">{mediaDict.playbackMode}</Label>
                <RadioGroup
                  value={playbackMode}
                  onValueChange={(v) => {
                    setPlaybackMode(v as 'default' | 'loop-single' | 'sequential');
                  }}
                  className="flex items-center gap-4 mt-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="default" id="mode-default" />
                    <Label htmlFor="mode-default" className="flex items-center gap-1 cursor-pointer"><Play className="h-4 w-4"/>{commonDict.default}</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="loop-single" id="mode-loop" />
                    <Label htmlFor="mode-loop" className="flex items-center gap-1 cursor-pointer"><Repeat1 className="h-4 w-4"/>{mediaDict.loopSingle}</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="sequential" id="mode-sequential" />
                    <Label htmlFor="mode-sequential" className="flex items-center gap-1 cursor-pointer">{mediaDict.listLoopMode}</Label>
                  </div>
                </RadioGroup>
            </div>
            <div className="flex items-center justify-center gap-4 my-4 p-2 rounded-lg bg-muted/50">
               <Button variant="ghost" size="icon" onClick={previous} disabled={!hasPrevious() || isPlaybackLoading}><SkipBack className="h-5 w-5"/></Button>
               <Button variant="ghost" size="icon" onClick={handleGlobalPlayPause} disabled={isPlaybackLoading || mediaItems.length === 0}>
                  {isPlaybackLoading ? <Loader2 className="h-6 w-6 animate-spin"/> : isPlaying && !isPaused ? <Pause className="h-6 w-6"/> : <Play className="h-6 w-6"/>}
               </Button>
               <Button variant="ghost" size="icon" onClick={next} disabled={!hasNext() || isPlaybackLoading}><SkipForward className="h-5 w-5"/></Button>
            </div>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{mediaDict.loadingMedia}</p>
        ) : mediaItems.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2"><Info className="h-5 w-5" />{mediaDict.emptyList}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {mediaItems.map((item) => {
              const isCurrentlyPlayingThis = currentItem?.item.id === item.id;
              
              let playButtonIcon;
              if (isPlaybackLoading && currentItem?.item.id === item.id) {
                  playButtonIcon = <Loader2 className="h-5 w-5 animate-spin" />;
              } else if (isCurrentlyPlayingThis && !isPaused) {
                  playButtonIcon = <Pause className="h-5 w-5" />;
              } else {
                  playButtonIcon = <Play className="h-5 w-5" />;
              }

              return (
              <Card key={item.id} className={cn("flex flex-col", isCurrentlyPlayingThis && "border-primary ring-2 ring-primary")}>
                <CardContent className="p-4 flex flex-col gap-3 flex-grow">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3 min-w-0">
                      {getMediaIcon(item.type)}
                      <div className='min-w-0'>
                        <p className={cn("font-semibold truncate")} title={item.name}>{item.name}</p>
                        <p className="text-xs text-muted-foreground">{mediaDict.addedDate}: {format(new Date(item.createdAt), "MMM d, yyyy HH:mm")}</p>
                      </div>
                    </div>
                     <div className="flex gap-2 mt-2 sm:mt-0 sm:items-center flex-shrink-0">
                          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setItemToDelete(item); }}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                    </div>
                  </div>
                  
                  <div className="w-full aspect-video bg-black rounded-md flex items-center justify-center relative">
                      {item.type === 'video' && (
                        <video 
                            src={getObjectUrl(item)}
                            className="w-full h-full object-contain"
                            // The video element is just for show; controls are handled globally
                        ></video>
                      )}
                      {item.type === 'audio' && (
                          <Music className="h-16 w-16 text-muted" />
                      )}
                      {/* Overlay Play Button */}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <Button
                              variant="ghost"
                              size="icon"
                              className="h-16 w-16 text-white hover:bg-white/20 hover:text-white"
                              onClick={() => handlePlayPause(item)}
                              disabled={isPlaybackLoading && !isCurrentlyPlayingThis}
                          >
                              {playButtonIcon}
                          </Button>
                      </div>
                  </div>
                  
                  {item.note && (
                    <div className="text-sm text-muted-foreground p-3 bg-muted/50 rounded-md flex items-start gap-2 mt-auto">
                        <MessageSquare className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <p className="whitespace-pre-wrap">{item.note}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )})}
          </div>
        )}
      </div>

      <Dialog open={!!uploadDialog.file} onOpenChange={(isOpen) => !isOpen && setUploadDialog({ file: null, note: '' })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mediaDict.addNoteTitle}</DialogTitle>
            <DialogDescription>
              {mediaDict.fileLabel}: <span className="font-semibold">{uploadDialog.file?.name}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="media-note">{commonDict.note} ({dictionary.home.favoritesDescription})</Label>
            <Textarea
              id="media-note"
              value={uploadDialog.note}
              onChange={(e) => setUploadDialog(prev => ({ ...prev, note: e.target.value }))}
              placeholder={mediaDict.notePlaceholder}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialog({ file: null, note: '' })}>{commonDict.cancel}</Button>
            <Button onClick={handleUploadConfirm} disabled={isUploading}>
              {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {commonDict.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <AlertDialog open={!!itemToDelete} onOpenChange={(isOpen) => !isOpen && setItemToDelete(null)}>
          <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{commonDict.areYouSure}</AlertDialogTitle>
                <AlertDialogDescription>
                  {mediaDict.deleteConfirmation.replace('{name}', itemToDelete?.name || '')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setItemToDelete(null)}>{commonDict.cancel}</AlertDialogCancel>
                <AlertDialogAction onClick={performDelete}>{commonDict.delete}</AlertDialogAction>
              </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </>
  );
}


export default function MediaPage() {
    return (
        <AuthGuard>
            <MediaFavoritesPageContent />
        </AuthGuard>
    )
}
