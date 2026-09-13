
"use client";

import { useState, useEffect, useContext } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BookOpenText, Library, Star, User, LogOut, ShieldCheck, NotebookText, Home, Film, Menu, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MangaTalkLogo } from '@/components/icons/MangaTalkLogo';
import { cn } from '@/lib/utils';
import { getCurrentUser, logout, isAdminSessionActive } from '@/lib/authService';
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';


const PROTECTED_ROUTES = ['/library', '/reader', '/favorites', '/notes-favorites', '/profile', '/admin', '/media'];

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  
  const isMobile = useIsMobile();
  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [currentUser, adminActive] = await Promise.all([getCurrentUser(), isAdminSessionActive()]);
      if (cancelled) return;
      setUser(currentUser);
      setIsAdmin(adminActive);

      if (!currentUser && PROTECTED_ROUTES.some(route => pathname.startsWith(route))) {
        router.replace('/');
      }
    })();
    return () => { cancelled = true; };
  }, [pathname, router]);
  
  useEffect(() => {
    setIsSheetOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    await logout();
    // Force a full page reload to the homepage.
    // This is the most reliable way to clear all state and avoid client/server mismatches
    // that can cause "Failed to fetch" errors on navigation after logout.
    window.location.href = '/';
  };

  const getLinkClass = (path: string) => {
    const isActive = path === '/' ? pathname === path : pathname.startsWith(path);
    return cn(
      "flex items-center gap-2 justify-start",
      isActive && "bg-accent text-accent-foreground rounded-md"
    );
  };
  
  if (pathname === '/' || pathname.startsWith('/login') || pathname.startsWith('/register') || pathname.startsWith('/i1lbklewq-6b24678_vvw019-qo0liuuu_w5sc2467-8do1yyvvye7z2nnmai17yt8b13hnhm_o01-ilylcgylbgc99')) {
      return null;
  }
  
  const navLinks = (
      <>
        <Button variant="ghost" asChild size="sm" className={getLinkClass('/')}>
          <Link href="/">
            <Home className="mr-1 h-4 w-4" /> {dictionary.nav.home}
          </Link>
        </Button>
        {user ? (
            <>
                <Button variant="ghost" asChild size="sm" className={getLinkClass('/library')}>
                <Link href="/library">
                    <Library className="mr-1 h-4 w-4" /> {dictionary.nav.library}
                </Link>
                </Button>
                <Button variant="ghost" asChild size="sm" className={getLinkClass('/reader')}>
                <Link href="/reader">
                    <BookOpenText className="mr-1 h-4 w-4" /> {dictionary.nav.reader}
                </Link>
                </Button>
                <Button variant="ghost" asChild size="sm" className={getLinkClass('/media')}>
                <Link href="/media">
                    <Film className="mr-1 h-4 w-4" /> {dictionary.nav.media}
                </Link>
                </Button>
                <Button variant="ghost" asChild size="sm" className={getLinkClass('/favorites')}>
                <Link href="/favorites">
                    <Star className="mr-1 h-4 w-4" /> {dictionary.nav.favorites}
                </Link>
                </Button>
                <Button variant="ghost" asChild size="sm" className={getLinkClass('/notes-favorites')}>
                <Link href="/notes-favorites">
                    <NotebookText className="mr-1 h-4 w-4" /> {dictionary.nav.notes}
                </Link>
                </Button>
                <Button variant="ghost" asChild size="sm" className={getLinkClass('/profile')}>
                <Link href="/profile">
                    <User className="mr-1 h-4 w-4" /> {dictionary.nav.profile}
                </Link>
                </Button>
                {isAdmin && (
                <Button variant="ghost" asChild size="sm" className={getLinkClass('/admin/management')}>
                    <Link href="/admin/management">
                        <ShieldCheck className="mr-1 h-4 w-4" /> {dictionary.nav.admin}
                    </Link>
                </Button>
                )}
                 <Button variant="ghost" size="sm" onClick={handleLogout} className="flex items-center gap-2 justify-start">
                    <LogOut className="mr-1 h-4 w-4" /> {dictionary.nav.logout}
                </Button>
            </>
        ) : (
            <Button variant="ghost" asChild size="sm" className={getLinkClass('/login')}>
                <Link href="/login">
                    <LogIn className="mr-1 h-4 w-4" /> {dictionary.nav.login}
                </Link>
            </Button>
        )}
      </>
    );


  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-2 md:gap-4">
          <Link href="/" className="flex items-center gap-2">
            <MangaTalkLogo className="h-8 w-8" />
            <h1 className="text-xl md:text-2xl font-bold font-headline text-primary">MangaTalk</h1>
          </Link>
          {!isMobile && (
            <nav className="hidden md:flex items-center gap-1 md:gap-2">
                {navLinks}
            </nav>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {isMobile && (
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                  <span className="sr-only">Open Menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[250px] p-4">
                  <SheetHeader>
                    <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                  </SheetHeader>
                  <nav className="flex flex-col gap-2 pt-4">
                      {navLinks}
                  </nav>
              </SheetContent>
            </Sheet>
          )}

          {!user && !isMobile && (
               <Button variant="ghost" size="sm" asChild>
                  <Link href="/login">{dictionary.nav.login}</Link>
              </Button>
          )}
        </div>
      </div>
    </header>
  );
}
