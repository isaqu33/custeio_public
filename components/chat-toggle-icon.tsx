import { Activity, MessageCircle, MessageSquare, Sparkles, Stethoscope } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ChatToggleIcon } from '@/app/lib/chat-branding';

// Maps each toggle-icon preset key to its lucide icon, for the admin preview and
// the in-iframe chat. (The host-page toggle button uses inline SVGs in
// public/chat-widget.js keyed by the same names.)
export const CHAT_TOGGLE_ICON_MAP: Record<ChatToggleIcon, LucideIcon> = {
  chat: MessageCircle,
  message: MessageSquare,
  stethoscope: Stethoscope,
  sparkles: Sparkles,
  activity: Activity,
};
