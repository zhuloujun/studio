"use client";

import { useState, useEffect, useContext, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { AdminAuthGuard } from '@/components/auth/AuthGuard';
import {
  getAllUsersForAdmin,
  deleteUserByAdmin,
  getAdminLoginUrlInfo,
  requestPasswordChangeOtp,
  changePassword,
  requestAdminLoginUrlChangeOtp,
  changeAdminLoginUrl,
} from '@/lib/authService';
import { Trash2, Users, KeyRound, AlertTriangle, Link as LinkIcon } from 'lucide-react';
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

const RESEND_COOLDOWN_SECONDS = 60;

function useCooldown() {
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const start = () => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timer.current) clearInterval(timer.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  return { cooldown, start };
}

function AdminManagementPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<{ email: string }[]>([]);
  const [userToDelete, setUserToDelete] = useState<{email: string} | null>(null);

  // --- Change admin password ---
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('');
  const [pwOtpCode, setPwOtpCode] = useState('');
  const [pwOtpRequested, setPwOtpRequested] = useState(false);
  const [isSendingPwOtp, setIsSendingPwOtp] = useState(false);
  const [isSubmittingPw, setIsSubmittingPw] = useState(false);
  const pwCooldown = useCooldown();

  // --- Change admin login URL ---
  const [currentLoginPath, setCurrentLoginPath] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [urlOtpCode, setUrlOtpCode] = useState('');
  const [urlOtpRequested, setUrlOtpRequested] = useState(false);
  const [isSendingUrlOtp, setIsSendingUrlOtp] = useState(false);
  const [isSubmittingUrl, setIsSubmittingUrl] = useState(false);
  const urlCooldown = useCooldown();

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const adminDict = dictionary.admin;

  const refreshUsers = async () => setUsers(await getAllUsersForAdmin());
  const refreshLoginUrl = async () => {
    const info = await getAdminLoginUrlInfo();
    if (info) setCurrentLoginPath(info.path);
  };

  useEffect(() => {
    refreshUsers();
    refreshLoginUrl();
  }, []);

  const performDelete = async () => {
    if (!userToDelete) return;

    const result = await deleteUserByAdmin(userToDelete.email);

    if (result.success) {
      toast({ title: adminDict.userDeleted, description: adminDict.userDeletedMessage.replace('{email}', userToDelete.email) });
      await refreshUsers();
    } else {
      toast({
        variant: 'destructive',
        title: adminDict.errorDeletingUser,
        description: result.message || 'An unknown error occurred.'
      });
    }
    setUserToDelete(null);
  };

  // --- Password change handlers ---
  const handleRequestPwOtp = async () => {
    if (newAdminPassword.length < 4) {
      toast({ variant: 'destructive', title: commonDict.error, description: dictionary.register.passwordLengthError });
      return;
    }
    if (newAdminPassword !== confirmAdminPassword) {
      toast({ variant: 'destructive', title: commonDict.error, description: '两次输入的密码不一致。' });
      return;
    }
    setIsSendingPwOtp(true);
    const result = await requestPasswordChangeOtp();
    setIsSendingPwOtp(false);

    if (result.success) {
      toast({ title: '验证码已发送', description: '请查收管理员邮箱中的 6 位验证码。' });
      setPwOtpRequested(true);
      pwCooldown.start();
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message });
    }
  };

  const handlePasswordChange = async () => {
    if (pwOtpCode.length !== 6) {
      toast({ variant: 'destructive', title: commonDict.error, description: '请输入 6 位验证码。' });
      return;
    }
    setIsSubmittingPw(true);
    const result = await changePassword(pwOtpCode, newAdminPassword);
    setIsSubmittingPw(false);

    if (result.success) {
      toast({ title: commonDict.success, description: adminDict.adminPasswordUpdated });
      setNewAdminPassword('');
      setConfirmAdminPassword('');
      setPwOtpCode('');
      setPwOtpRequested(false);
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message || adminDict.failedToUpdateAdminPassword });
    }
  };

  // --- Login URL change handlers ---
  const handleRequestUrlOtp = async () => {
    const trimmed = newSlug.trim();
    if (!/^[a-zA-Z0-9_-]{12,120}$/.test(trimmed)) {
      toast({ variant: 'destructive', title: commonDict.error, description: '登录地址只能包含字母、数字、下划线和短横线，长度需在 12-120 位之间。' });
      return;
    }
    setIsSendingUrlOtp(true);
    const result = await requestAdminLoginUrlChangeOtp();
    setIsSendingUrlOtp(false);

    if (result.success) {
      toast({ title: '验证码已发送', description: '请查收管理员邮箱中的 6 位验证码。' });
      setUrlOtpRequested(true);
      urlCooldown.start();
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message });
    }
  };

  const handleUrlChange = async () => {
    if (urlOtpCode.length !== 6) {
      toast({ variant: 'destructive', title: commonDict.error, description: '请输入 6 位验证码。' });
      return;
    }
    setIsSubmittingUrl(true);
    const result = await changeAdminLoginUrl(urlOtpCode, newSlug.trim());
    setIsSubmittingUrl(false);

    if (result.success) {
      toast({ title: commonDict.success, description: '登录地址已更新，请记好新的地址（旧地址将立即失效）。' });
      if (result.path) setCurrentLoginPath(result.path);
      setNewSlug('');
      setUrlOtpCode('');
      setUrlOtpRequested(false);
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message || '修改登录地址失败。' });
    }
  };

  return (
    <>
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold">{adminDict.title}</h1>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users />{adminDict.userManagement}</CardTitle>
            <CardDescription>{adminDict.userManagementDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {users.length > 0 ? (
                <ul className="space-y-2">
                {users.map(user => (
                    <li key={user.email} className="flex items-center justify-between p-2 border rounded-md">
                    <span>{user.email}</span>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setUserToDelete(user)}
                        aria-label={`Delete user ${user.email}`}
                    >
                        <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                    </li>
                ))}
                </ul>
            ) : (
                <p className="text-muted-foreground">{adminDict.noOtherUsers}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound />{adminDict.changeAdminPassword}</CardTitle>
            <CardDescription>需要邮箱验证码才能修改。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="admin-password">{commonDict.newPassword}</Label>
            <Input
              id="admin-password"
              type="password"
              value={newAdminPassword}
              onChange={e => setNewAdminPassword(e.target.value)}
              placeholder={adminDict.newAdminPasswordPlaceholder}
              disabled={pwOtpRequested}
            />
            <Label htmlFor="admin-password-confirm">{commonDict.confirmNewPassword}</Label>
            <Input
              id="admin-password-confirm"
              type="password"
              value={confirmAdminPassword}
              onChange={e => setConfirmAdminPassword(e.target.value)}
              placeholder={commonDict.confirmNewPassword}
              disabled={pwOtpRequested}
            />
            {!pwOtpRequested ? (
              <Button onClick={handleRequestPwOtp} className="mt-2" disabled={isSendingPwOtp}>
                {isSendingPwOtp ? '发送中...' : '发送邮箱验证码'}
              </Button>
            ) : (
              <div className="mt-2 space-y-2">
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位验证码"
                  value={pwOtpCode}
                  onChange={(e) => setPwOtpCode(e.target.value.replace(/\D/g, ''))}
                />
                <div className="flex gap-2">
                  <Button onClick={handlePasswordChange} disabled={isSubmittingPw}>
                    {isSubmittingPw ? '提交中...' : adminDict.savePassword}
                  </Button>
                  <Button variant="link" disabled={pwCooldown.cooldown > 0 || isSendingPwOtp} onClick={handleRequestPwOtp}>
                    {pwCooldown.cooldown > 0 ? `重新发送 (${pwCooldown.cooldown}s)` : '重新发送'}
                  </Button>
                  <Button variant="ghost" onClick={() => { setPwOtpRequested(false); setPwOtpCode(''); }}>
                    取消
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><LinkIcon />{adminDict.adminLoginURL}</CardTitle>
            <CardDescription>修改登录地址需要邮箱验证码。修改后旧地址会立即失效，请务必记好新地址再提交。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label>当前登录地址</Label>
            <Input value={currentLoginPath} readOnly disabled />

            <Label htmlFor="new-slug">新登录地址（仅填路径最后一段，字母/数字/下划线/短横线，12-120 位）</Label>
            <Input
              id="new-slug"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="例如：my-secret-admin-entrance-2026"
              disabled={urlOtpRequested}
            />
            {!urlOtpRequested ? (
              <Button onClick={handleRequestUrlOtp} className="mt-2" disabled={isSendingUrlOtp}>
                {isSendingUrlOtp ? '发送中...' : '发送邮箱验证码'}
              </Button>
            ) : (
              <div className="mt-2 space-y-2">
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位验证码"
                  value={urlOtpCode}
                  onChange={(e) => setUrlOtpCode(e.target.value.replace(/\D/g, ''))}
                />
                <div className="flex gap-2">
                  <Button onClick={handleUrlChange} disabled={isSubmittingUrl}>
                    {isSubmittingUrl ? '提交中...' : '确认修改'}
                  </Button>
                  <Button variant="link" disabled={urlCooldown.cooldown > 0 || isSendingUrlOtp} onClick={handleRequestUrlOtp}>
                    {urlCooldown.cooldown > 0 ? `重新发送 (${urlCooldown.cooldown}s)` : '重新发送'}
                  </Button>
                  <Button variant="ghost" onClick={() => { setUrlOtpRequested(false); setUrlOtpCode(''); }}>
                    取消
                  </Button>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" /> 修改后请立刻把新地址记录在安全的地方，忘记地址不影响登录本身（可以联系开发者从数据库查询），但会不方便。
            </p>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!userToDelete} onOpenChange={(isOpen) => !isOpen && setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{commonDict.areYouSure}</AlertDialogTitle>
            <AlertDialogDescription>
              {commonDict.actionCannotBeUndone} {adminDict.deleteUserConfirmation.replace('{email}', userToDelete?.email || '')}
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

export default function AdminManagementPageWrapper() {
  return (
    <AdminAuthGuard>
      <AdminManagementPage />
    </AdminAuthGuard>
  );
}
