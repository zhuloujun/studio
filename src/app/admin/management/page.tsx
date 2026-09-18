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
  changeAdminPasswordWithToken,
  changeAdminLoginUrl,
  requestAdminSettingsOtp,
  verifyAdminSettingsOtp,
  getLibraryLinksForAdmin,
  setLibraryLinks,
  type LibraryLink,
  getStorageUsage,
  setStorageQuota,
  backfillStorageUsage,
  type UserStorageUsage,
} from '@/lib/authService';
import { Trash2, Users, KeyRound, AlertTriangle, Link as LinkIcon, BookMarked, HardDrive } from 'lucide-react';
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
  const [isSubmittingPw, setIsSubmittingPw] = useState(false);

  // --- Change admin login URL ---
  const [currentLoginPath, setCurrentLoginPath] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [isSubmittingUrl, setIsSubmittingUrl] = useState(false);

  // --- Unified admin-settings-change verification (gates every admin write action: password, login URL, "文献库" links, storage quota, user deletion) ---
  const settingsOtpCooldown = useCooldown();
  const [settingsOtpCode, setSettingsOtpCode] = useState('');
  const [isSendingSettingsOtp, setIsSendingSettingsOtp] = useState(false);
  const [isVerifyingSettingsOtp, setIsVerifyingSettingsOtp] = useState(false);
  const [settingsVerificationToken, setSettingsVerificationToken] = useState<string | null>(null);

  // --- "文献库" quick-links (multiple) ---
  const [libraryLinks, setLibraryLinksState] = useState<LibraryLink[]>([]);
  const [isSavingLibraryLink, setIsSavingLibraryLink] = useState(false);

  // --- Storage quota ---
  const [storageUsers, setStorageUsers] = useState<UserStorageUsage[]>([]);
  const [quotaGBInput, setQuotaGBInput] = useState('5');
  const [isSavingQuota, setIsSavingQuota] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const adminDict = dictionary.admin;

  const refreshUsers = async () => setUsers(await getAllUsersForAdmin());
  const refreshLoginUrl = async () => {
    const info = await getAdminLoginUrlInfo();
    if (info) setCurrentLoginPath(info.path);
  };
  const refreshLibraryLinks = async () => {
    const links = await getLibraryLinksForAdmin();
    setLibraryLinksState(links.length > 0 ? links : [{ url: '', label: '' }]);
  };
  const refreshStorageUsage = async () => {
    const result = await getStorageUsage();
    if (result) {
      setStorageUsers(result.users);
      setQuotaGBInput((result.quotaBytes / (1024 * 1024 * 1024)).toFixed(1));
    }
  };

  useEffect(() => {
    refreshUsers();
    refreshLoginUrl();
    refreshLibraryLinks();
    refreshStorageUsage();
  }, []);

  const handleLibraryLinkChange = (index: number, field: 'url' | 'label', value: string) => {
    setLibraryLinksState((prev) => prev.map((link, i) => (i === index ? { ...link, [field]: value } : link)));
  };
  const handleAddLibraryLinkRow = () => setLibraryLinksState((prev) => [...prev, { url: '', label: '' }]);
  const handleRemoveLibraryLinkRow = (index: number) =>
    setLibraryLinksState((prev) => prev.filter((_, i) => i !== index));

  const handleSendSettingsOtp = async () => {
    setIsSendingSettingsOtp(true);
    const result = await requestAdminSettingsOtp();
    setIsSendingSettingsOtp(false);
    if (result.success) {
      toast({ title: commonDict.success, description: '验证码已发送，请查收邮箱。' });
      settingsOtpCooldown.start();
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message || '发送失败。' });
    }
  };

  const handleVerifySettingsOtp = async () => {
    if (!settingsOtpCode.trim()) return;
    setIsVerifyingSettingsOtp(true);
    const result = await verifyAdminSettingsOtp(settingsOtpCode.trim());
    setIsVerifyingSettingsOtp(false);
    if (result.success && result.token) {
      setSettingsVerificationToken(result.token);
      setSettingsOtpCode('');
      toast({ title: commonDict.success, description: '验证通过，15 分钟内可以保存下方各项设置。' });
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message || '验证码不正确。' });
    }
  };

  const handleSaveLibraryLink = async () => {
    if (!settingsVerificationToken) {
      toast({ variant: 'destructive', title: commonDict.error, description: '请先完成邮箱验证码验证。' });
      return;
    }
    setIsSavingLibraryLink(true);
    const result = await setLibraryLinks(libraryLinks, settingsVerificationToken);
    setIsSavingLibraryLink(false);
    if (result.success) {
      toast({ title: commonDict.success, description: '文献库跳转链接已更新。' });
      refreshLibraryLinks();
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message || '保存失败。' });
    }
  };

  const handleSaveQuota = async () => {
    if (!settingsVerificationToken) {
      toast({ variant: 'destructive', title: commonDict.error, description: '请先完成邮箱验证码验证。' });
      return;
    }
    const quotaGB = parseFloat(quotaGBInput);
    if (!Number.isFinite(quotaGB) || quotaGB <= 0) {
      toast({ variant: 'destructive', title: commonDict.error, description: '请输入一个大于 0 的数字。' });
      return;
    }
    setIsSavingQuota(true);
    const result = await setStorageQuota(quotaGB, settingsVerificationToken);
    setIsSavingQuota(false);
    if (result.success) {
      toast({ title: commonDict.success, description: '默认存储限额已更新。' });
      refreshStorageUsage();
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message || '保存失败。' });
    }
  };

  const formatBytes = (bytes: number) => `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;

  const handleBackfillStorage = async () => {
    setIsBackfilling(true);
    const result = await backfillStorageUsage();
    setIsBackfilling(false);
    if (result.success) {
      toast({ title: commonDict.success, description: `已补全 ${result.updated ?? 0} 条记录的存储大小。` });
      refreshStorageUsage();
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message || '回填失败。' });
    }
  };

  const performDelete = async () => {
    if (!userToDelete) return;
    if (!settingsVerificationToken) {
      toast({ variant: 'destructive', title: commonDict.error, description: '请先在上方完成邮箱验证码验证。' });
      setUserToDelete(null);
      return;
    }

    const result = await deleteUserByAdmin(userToDelete.email, settingsVerificationToken);

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

  // --- Password change handler (uses the unified verification token) ---
  const handlePasswordChange = async () => {
    if (!settingsVerificationToken) {
      toast({ variant: 'destructive', title: commonDict.error, description: '请先在上方完成邮箱验证码验证。' });
      return;
    }
    if (newAdminPassword.length < 4) {
      toast({ variant: 'destructive', title: commonDict.error, description: dictionary.register.passwordLengthError });
      return;
    }
    if (newAdminPassword !== confirmAdminPassword) {
      toast({ variant: 'destructive', title: commonDict.error, description: '两次输入的密码不一致。' });
      return;
    }
    setIsSubmittingPw(true);
    const result = await changeAdminPasswordWithToken(newAdminPassword, settingsVerificationToken);
    setIsSubmittingPw(false);

    if (result.success) {
      toast({ title: commonDict.success, description: adminDict.adminPasswordUpdated });
      setNewAdminPassword('');
      setConfirmAdminPassword('');
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message || adminDict.failedToUpdateAdminPassword });
    }
  };

  // --- Login URL change handler (uses the unified verification token) ---
  const handleUrlChange = async () => {
    if (!settingsVerificationToken) {
      toast({ variant: 'destructive', title: commonDict.error, description: '请先在上方完成邮箱验证码验证。' });
      return;
    }
    const trimmed = newSlug.trim();
    if (!/^[a-zA-Z0-9_-]{12,120}$/.test(trimmed)) {
      toast({ variant: 'destructive', title: commonDict.error, description: '登录地址只能包含字母、数字、下划线和短横线，长度需在 12-120 位之间。' });
      return;
    }
    setIsSubmittingUrl(true);
    const result = await changeAdminLoginUrl(trimmed, settingsVerificationToken);
    setIsSubmittingUrl(false);

    if (result.success) {
      toast({ title: commonDict.success, description: '登录地址已更新，请记好新的地址（旧地址将立即失效）。' });
      if (result.path) setCurrentLoginPath(result.path);
      setNewSlug('');
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: result.message || '修改登录地址失败。' });
    }
  };

  return (
    <>
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold">{adminDict.title}</h1>

        <Card className={settingsVerificationToken ? 'border-green-500/50' : 'border-amber-500/50'}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound />设置修改验证</CardTitle>
            <CardDescription>
              为防止账号被盗后台被篡改，这个页面里所有会修改数据的操作（修改管理员密码、修改登录地址、删除用户、文献库导航、存储限额，以及以后新增的模块）都统一走这一个验证——先在这里发送并验证一次邮箱验证码，15 分钟内可以保存/删除多次，不用每个模块单独发验证码。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {settingsVerificationToken ? (
              <p className="text-sm text-green-600 flex items-center gap-1.5">
                <KeyRound className="h-4 w-4" /> 已验证，15 分钟内可以保存下方设置。
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <Button onClick={handleSendSettingsOtp} disabled={isSendingSettingsOtp || settingsOtpCooldown.cooldown > 0} variant="outline">
                  {settingsOtpCooldown.cooldown > 0 ? `${settingsOtpCooldown.cooldown}秒后可重发` : isSendingSettingsOtp ? '发送中...' : '发送邮箱验证码'}
                </Button>
                <div>
                  <Label htmlFor="settings-otp-code">验证码</Label>
                  <Input
                    id="settings-otp-code"
                    value={settingsOtpCode}
                    onChange={(e) => setSettingsOtpCode(e.target.value)}
                    placeholder="6 位数字"
                    className="w-32"
                  />
                </div>
                <Button onClick={handleVerifySettingsOtp} disabled={isVerifyingSettingsOtp || !settingsOtpCode.trim()}>
                  {isVerifyingSettingsOtp ? '验证中...' : '验证'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

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
                        disabled={!settingsVerificationToken}
                        title={!settingsVerificationToken ? '请先在上方完成邮箱验证码验证' : undefined}
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
            <CardDescription>需要先在最上方"设置修改验证"完成邮箱验证码验证才能保存。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="admin-password">{commonDict.newPassword}</Label>
            <Input
              id="admin-password"
              type="password"
              value={newAdminPassword}
              onChange={e => setNewAdminPassword(e.target.value)}
              placeholder={adminDict.newAdminPasswordPlaceholder}
            />
            <Label htmlFor="admin-password-confirm">{commonDict.confirmNewPassword}</Label>
            <Input
              id="admin-password-confirm"
              type="password"
              value={confirmAdminPassword}
              onChange={e => setConfirmAdminPassword(e.target.value)}
              placeholder={commonDict.confirmNewPassword}
            />
            <Button onClick={handlePasswordChange} className="mt-2" disabled={isSubmittingPw || !settingsVerificationToken}>
              {isSubmittingPw ? '提交中...' : adminDict.savePassword}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><LinkIcon />{adminDict.adminLoginURL}</CardTitle>
            <CardDescription>需要先在最上方"设置修改验证"完成邮箱验证码验证才能保存。修改后旧地址会立即失效，请务必记好新地址再提交。</CardDescription>
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
            />
            <Button onClick={handleUrlChange} className="mt-2" disabled={isSubmittingUrl || !settingsVerificationToken}>
              {isSubmittingUrl ? '提交中...' : '确认修改'}
            </Button>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" /> 修改后请立刻把新地址记录在安全的地方，忘记地址不影响登录本身（可以联系开发者从数据库查询），但会不方便。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookMarked />"文献库"导航模块</CardTitle>
            <CardDescription>
              配置后，普通用户在 library 页面会看到一个独立的"文献库"导航区域，每一行对应一个跳转按钮（比如各个机构图书馆入口）。可以添加多个，全部留空则不显示这个模块。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {libraryLinks.map((link, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="flex-1">
                  <Label htmlFor={`library-link-label-${index}`}>按钮文字</Label>
                  <Input
                    id={`library-link-label-${index}`}
                    value={link.label}
                    onChange={(e) => handleLibraryLinkChange(index, 'label', e.target.value)}
                    placeholder="例如：图书馆入口"
                  />
                </div>
                <div className="flex-[2]">
                  <Label htmlFor={`library-link-url-${index}`}>跳转地址</Label>
                  <Input
                    id={`library-link-url-${index}`}
                    value={link.url}
                    onChange={(e) => handleLibraryLinkChange(index, 'url', e.target.value)}
                    placeholder="https://example.com"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveLibraryLinkRow(index)}
                  disabled={libraryLinks.length <= 1}
                  title="删除这一行"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleAddLibraryLinkRow}>
                + 添加一个链接
              </Button>
              <Button onClick={handleSaveLibraryLink} disabled={isSavingLibraryLink || !settingsVerificationToken}>
                {isSavingLibraryLink ? '保存中...' : '保存全部'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><HardDrive />存储限额</CardTitle>
            <CardDescription>
              每个普通用户的文档+媒体文件总大小不能超过这个限额，防止个别账号占用过多存储导致资源紧张。所有用户共用同一个限额。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="flex-1 max-w-[200px]">
                <Label htmlFor="quota-gb">默认限额（GB）</Label>
                <Input
                  id="quota-gb"
                  type="number"
                  min="0.1"
                  step="0.5"
                  value={quotaGBInput}
                  onChange={(e) => setQuotaGBInput(e.target.value)}
                />
              </div>
              <Button onClick={handleSaveQuota} disabled={isSavingQuota || !settingsVerificationToken}>
                {isSavingQuota ? '保存中...' : '保存'}
              </Button>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>各用户存储用量</Label>
                <Button size="sm" variant="ghost" onClick={handleBackfillStorage} disabled={isBackfilling} title="如果某些账号明明有文件却显示 0GB，点这个补算一次（早于配额功能上线的旧文件不会自动记录大小）">
                  {isBackfilling ? '计算中...' : '重新计算用量'}
                </Button>
              </div>
              {storageUsers.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {storageUsers.map((u) => (
                    <li key={u.email} className="p-2 border rounded-md">
                      <div className="flex items-center justify-between text-sm">
                        <span>{u.email}</span>
                        <span className="text-muted-foreground">
                          {formatBytes(u.usedBytes)} / {formatBytes(u.quotaBytes)}（{u.percentage}%）
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                        <div
                          className={u.percentage >= 90 ? 'h-full bg-destructive' : 'h-full bg-primary'}
                          style={{ width: `${Math.min(100, u.percentage)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground mt-2">暂无用户数据。</p>
              )}
            </div>
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
