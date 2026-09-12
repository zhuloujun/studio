
"use client";

import { useState, useEffect, useContext } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { loginUser } from '@/lib/authService';
import * as LocalStorageService from '@/lib/localStorageService';
import { MangaTalkLogo } from '@/components/icons/MangaTalkLogo';
import { AlertCircle } from 'lucide-react';
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const loginDict = dictionary.login;

  // Captcha state
  const [num1, setNum1] = useState(0);
  const [num2, setNum2] = useState(0);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  
  const generateCaptcha = () => {
    setNum1(Math.floor(Math.random() * 10));
    setNum2(Math.floor(Math.random() * 10));
    setCaptchaAnswer('');
  };

  useEffect(() => {
    const rememberedEmail = LocalStorageService.getRememberedEmail();
    if (rememberedEmail) {
      setEmail(rememberedEmail);
      setRememberMe(true);
    }
    generateCaptcha();
  }, []);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async () => {
    setError('');

    if (parseInt(captchaAnswer, 10) !== num1 + num2) {
        setError(loginDict.incorrectAnswer);
        generateCaptcha();
        return;
    }

    setIsSubmitting(true);
    const result = await loginUser(email, password);
    setIsSubmitting(false);
    if (result.success) {
      if (rememberMe) {
        LocalStorageService.saveRememberedEmail(email);
      } else {
        LocalStorageService.clearRememberedEmail();
      }
      toast({ title: loginDict.loginSuccessful });
      router.push('/library');
    } else {
      setError(result.message || loginDict.loginFailed);
      generateCaptcha();
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40">
      <div className="absolute top-8 flex items-center gap-2">
        <MangaTalkLogo className="h-8 w-8" />
        <h1 className="text-2xl font-bold text-primary">MangaTalk</h1>
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{loginDict.title}</CardTitle>
          <CardDescription>{loginDict.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{commonDict.email}</Label>
            <Input
              id="email"
              type="email"
              placeholder={loginDict.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{commonDict.password}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="captcha">{loginDict.verification.replace('{num1}', String(num1)).replace('{num2}', String(num2))}</Label>
            <Input
              id="captcha"
              type="number"
              placeholder={loginDict.answerPlaceholder}
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              required
            />
          </div>
           <div className="flex items-center space-x-2">
            <Checkbox id="remember-me" checked={rememberMe} onCheckedChange={(checked) => setRememberMe(Boolean(checked))} />
            <Label htmlFor="remember-me" className="text-sm font-normal cursor-pointer">{loginDict.rememberEmail}</Label>
          </div>
           {error && <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</p>}
          <Button onClick={handleLogin} className="w-full" disabled={isSubmitting}>
            {isSubmitting ? '登录中...' : dictionary.nav.login}
          </Button>
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            {loginDict.dontHaveAccount}{' '}
            <Link href="/register" className="text-primary hover:underline">
              {loginDict.registerLink}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
