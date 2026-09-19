"use client";

import { usePlayback } from '@/components/player/PlaybackProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Play, Pause, SkipBack, SkipForward, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { Slider } from '@/components/ui/slider';

export default function FloatingPlayer() {
  const {
    isPlaying,
    isPaused,
    isLoading,
    currentItem,
    currentText,
    playlist,
    play,
    pause,
    resume,
    next,
    previous,
    stop,
    hasNext,
    hasPrevious,
    setVideoPlayerRef, // Use the new callback ref setter
    progress,
    duration,
    handleSeek,
    videoAspectRatio,
  } = usePlayback();

  // The player used to have `drag` listening across the *entire* card -
  // including the buttons, the seek slider, and the native CSS `resize`
  // handle in its bottom-right corner. All of those have their own pointer
  // handling, and framer-motion's drag gesture recognizer was competing
  // with them for the same pointerdown events: sometimes the slider or the
  // resize handle would "win" and drag never started, sometimes framer
  // would win and swallow a click, and sometimes the two ended up with
  // inconsistent pointer-capture state, which is what let the card keep
  // following the mouse after it was released (or refuse to move at all)
  // depending on exactly where the drag started. Scoping `drag` to only
  // start from the small handle bar at the top - via `dragListener={false}`
  // and manually calling `dragControls.start()` from that bar's own
  // onPointerDown - is framer-motion's documented pattern for this and
  // keeps every other control (and the resize handle) working normally.
  const dragControls = useDragControls();

  const handlePlayPause = () => {
    if (isPlaying) {
      if (isPaused) {
        resume();
      } else {
        pause();
      }
    } else if (playlist.length > 0) {
      play(playlist[0], playlist, 0);
    }
  };

  const getPlayButtonIcon = () => {
    if (isLoading) return <Loader2 className="h-5 w-5 animate-spin" />;
    if (isPlaying && !isPaused) return <Pause className="h-5 w-5" />;
    return <Play className="h-5 w-5" />;
  };

  const getPlayButtonText = () => {
    if (isLoading) return "Loading";
    if (isPlaying && !isPaused) return "Pause";
    if (isPaused) return "Resume";
    return "Play";
  }

  const truncateText = (text: string, length = 100) => {
    if (text.length <= length) return text;
    return text.substring(0, length) + '...';
  };
  
  const sourceText = currentItem?.type === 'note_favorite' 
    ? `Note for: "${truncateText(currentItem.item.annotation.targetText, 50)}"`
    : currentItem?.item.sourceDocumentName || 'Favorite Item';

  const isVideo = currentItem?.type === 'media_favorite' && currentItem.item.type === 'video';

  return (
    <AnimatePresence>
      {isPlaying && currentItem && (
        <motion.div
          drag
          dragListener={false}
          dragControls={dragControls}
          dragMomentum={false}
          dragElastic={0}
          className="fixed bottom-4 right-4 z-50 w-[512px] min-w-[300px] max-w-[80vw] min-h-[140px] resize overflow-hidden"
          style={{
            aspectRatio: isVideo && videoAspectRatio ? videoAspectRatio : undefined,
          }}
          initial={{ y: '110%' }}
          animate={{ y: 0 }}
          exit={{ y: '110%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <Card className="w-full h-full shadow-2xl bg-background/80 backdrop-blur-sm flex flex-col" >

            <div
              className="p-1 flex items-center justify-end bg-background/50 cursor-move touch-none"
              onPointerDown={(e) => dragControls.start(e)}
            >
               <Button variant="ghost" size="icon" className="h-6 w-6" onClick={stop}>
                    <X className="h-4 w-4"/>
                    <span className="sr-only">Close Player</span>
                </Button>
            </div>
            
            <CardContent className="p-4 flex flex-col gap-4 relative flex-grow min-h-0">
                {/* Video Player - will be visible if 'isVideo' is true */}
                <div className={cn("w-full bg-black rounded-md flex-grow min-h-0", isVideo ? "block" : "hidden")}>
                    <video
                      ref={setVideoPlayerRef} // Pass the DOM element to the provider
                      className="w-full h-full object-contain"
                      playsInline
                    />
                </div>

                {(currentItem.type === 'media_favorite' || (currentItem.type !== 'media_favorite' && duration > 0)) && (
                    <Slider
                      value={[progress]}
                      max={100}
                      step={1}
                      onValueChange={([value]) => handleSeek(value)}
                      disabled={isLoading || duration === 0}
                      className="w-full"
                    />
                )}

                <div className="flex items-center gap-4 w-full mt-auto flex-shrink-0 min-w-[280px]">
                    <div className="flex-grow min-w-0">
                        <p className="text-sm font-medium truncate text-primary" title={currentText}>
                            {currentText ? `“${truncateText(currentText)}”` : 'Loading...'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate" title={sourceText}>
                        {sourceText}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                        variant="ghost"
                        size="icon"
                        onClick={previous}
                        disabled={!hasPrevious() || isLoading}
                        aria-label="Previous"
                        >
                        <SkipBack className="h-5 w-5" />
                        </Button>
                        <Button
                        variant="default"
                        size="icon"
                        className="h-12 w-12 rounded-full"
                        onClick={handlePlayPause}
                        disabled={isLoading}
                        aria-label={getPlayButtonText()}
                        >
                        {getPlayButtonIcon()}
                        </Button>
                        <Button
                        variant="ghost"
                        size="icon"
                        onClick={next}
                        disabled={!hasNext() || isLoading}
                        aria-label="Next"
                        >
                        <SkipForward className="h-5 w-5" />
                        </Button>
                    </div>
                </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
