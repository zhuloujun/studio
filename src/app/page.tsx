
'use client';

import { useEffect, useState, useContext } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MangaTalkLogo } from '@/components/icons/MangaTalkLogo';
import { BookOpenText, Library, Star, NotebookText, ArrowRight, Film, Languages } from 'lucide-react';
import { getCurrentUser } from '@/lib/authService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LanguageContext, languages } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

interface ModuleCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
  isLoggedIn: boolean;
}

function ModuleCard({ title, description, icon, href, isLoggedIn }: ModuleCardProps) {
  const finalHref = isLoggedIn ? href : '/login';

  return (
    <Link href={finalHref} className="block hover:shadow-lg transition-shadow rounded-lg">
      <Card className="h-full flex flex-col">
        <CardHeader className="flex flex-row items-center gap-4">
          <div className="bg-primary/10 p-3 rounded-full">
            {icon}
          </div>
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex-grow flex justify-end items-end">
            <ArrowRight className="text-muted-foreground group-hover:text-primary" />
        </CardContent>
      </Card>
    </Link>
  );
}


export default function HomePage() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const { locale, setLocale } = useContext(LanguageContext);
    const dictionary = getDictionary(locale);

    useEffect(() => {
        let cancelled = false;
        (async () => {
          // This check runs only on the client-side
          const user = await getCurrentUser();
          if (cancelled) return;
          setIsLoggedIn(!!user);
          setIsLoading(false);
        })();
        return () => { cancelled = true; };
    }, []);

    const modules = [
        {
            title: dictionary.home.libraryTitle,
            description: dictionary.home.libraryDescription,
            icon: <Library className="h-6 w-6 text-primary" />,
            href: "/library"
        },
        {
            title: dictionary.home.readerTitle,
            description: dictionary.home.readerDescription,
            icon: <BookOpenText className="h-6 w-6 text-primary" />,
            href: "/reader"
        },
        {
            title: dictionary.home.mediaTitle,
            description: dictionary.home.mediaDescription,
            icon: <Film className="h-6 w-6 text-primary" />,
            href: "/media"
        },
        {
            title: dictionary.home.favoritesTitle,
            description: dictionary.home.favoritesDescription,
            icon: <Star className="h-6 w-6 text-primary" />,
            href: "/favorites"
        },
        {
            title: dictionary.home.notesTitle,
            description: dictionary.home.notesDescription,
            icon: <NotebookText className="h-6 w-6 text-primary" />,
            href: "/notes-favorites"
        }
    ];

    if (isLoading) {
        return null; // Or a loading spinner, to prevent flash of incorrect state
    }

    return (
        <div className="flex flex-col min-h-screen bg-muted/20">
             <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
                    <Link href="/" className="flex items-center gap-2">
                        <MangaTalkLogo className="h-8 w-8" />
                        <h1 className="text-xl md:text-2xl font-bold font-headline text-primary">MangaTalk</h1>
                    </Link>
                    <div className="flex items-center gap-2">
                         <Select value={locale} onValueChange={(value) => setLocale(value as any)}>
                            <SelectTrigger className="w-auto h-9 border-none focus:ring-0">
                                <SelectValue asChild>
                                     <div className="flex items-center gap-2">
                                        <Languages className="h-4 w-4" />
                                        <span className="hidden md:inline">{languages.find(l => l.code === locale)?.name}</span>
                                     </div>
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent align="end">
                                {languages.map(lang => (
                                    <SelectItem key={lang.code} value={lang.code}>{lang.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {isLoggedIn ? (
                             <Button asChild>
                                <Link href="/library">Go to App</Link>
                            </Button>
                        ) : (
                            <>
                                <Button variant="ghost" asChild>
                                    <Link href="/login">{dictionary.nav.login}</Link>
                                </Button>
                                <Button asChild>
                                    <Link href="/register">{dictionary.home.register}</Link>
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-grow">
                <section className="container mx-auto px-4 md:px-6 py-12 md:py-24 text-center">
                    <h2 className="text-4xl md:text-5xl font-bold tracking-tight">{dictionary.home.title}</h2>
                    <p className="mt-4 max-w-2xl mx-auto text-lg text-muted-foreground">
                        {dictionary.home.description}
                    </p>
                </section>

                <section className="container mx-auto px-4 md:px-6 pb-16">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                       {modules.map(mod => (
                           <ModuleCard key={mod.title} {...mod} isLoggedIn={isLoggedIn} />
                       ))}
                    </div>
                </section>
            </main>
             <footer className="py-6 border-t bg-background">
                <div className="container mx-auto text-center text-sm text-muted-foreground">
                    {dictionary.home.footer}
                </div>
            </footer>
        </div>
    );
}
