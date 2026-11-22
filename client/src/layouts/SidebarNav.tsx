import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Info,
  BookOpen,
  Home,
  LucideIcon,
  User,
  Plug,
} from "lucide-react";
import { cn } from "../utils/cn";
import { SearchChatModal } from "../components/chat/SearchChatModal";
import { useChatStore } from "../store";
import { SidebarNavItem, SidebarChatSection } from "./sidebar";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export const navigationItems: NavItem[] = [
  {
    title: "Home",
    href: "/",
    icon: Home,
  },
  {
    title: "Knowledge Base",
    href: "/knowledge-base",
    icon: BookOpen,
  },
  {
    title: "Connectors",
    href: "/connectors",
    icon: Plug,
  },
  {
    title: "People",
    href: "/org",
    icon: User,
  },
  {
    title: "About",
    href: "/about",
    icon: Info,
  },
];

export interface SidebarNavProps {
  isCollapsed?: boolean;
  onNavigate?: () => void;
  className?: string;
  setIsCollapsed?: (isCollapsed: boolean) => void;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({
  isCollapsed = false,
  onNavigate,
  className,
  setIsCollapsed,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const { chatList, isLoadingChatList, fetchChatList, deleteChat } =
    useChatStore();

  useEffect(() => {
    fetchChatList();
  }, [fetchChatList]);

  const handleSelectChat = (chatId: string) => {
    navigate(`/chat/${chatId}`);
    onNavigate?.();
  };

  const handleDeleteChat = async (chatId: string) => {
    try {
      const success = await deleteChat(chatId);
      if (success && location.pathname === `/chat/${chatId}`) {
        navigate("/");
      }
    } catch (err) {
      console.error("Failed to delete chat thread:", err);
    }
  };

  const homeItem = navigationItems[0];
  const otherItems = navigationItems.slice(1);

  return (
    <>
      <nav
        aria-label="Main Navigation"
        className={cn("flex flex-col gap-1 px-2 py-4", className)}
      >
        {/* 1. Home Navigation Link */}
        <SidebarNavItem
          title={homeItem.title}
          href={homeItem.href}
          icon={homeItem.icon}
          isCollapsed={isCollapsed}
          onNavigate={onNavigate}
          exact
        />

        {/* 2. Collapsible Chat Section */}
        <SidebarChatSection
          isCollapsed={isCollapsed}
          setIsCollapsed={setIsCollapsed}
          onNavigate={onNavigate}
          onOpenSearch={() => setIsSearchOpen(true)}
          chatList={chatList}
          isLoading={isLoadingChatList}
          onDeleteChat={handleDeleteChat}
        />

        {/* 3. Remaining Navigation Items */}
        {otherItems.map((item) => (
          <SidebarNavItem
            key={item.href}
            title={item.title}
            href={item.href}
            icon={item.icon}
            isCollapsed={isCollapsed}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      {/* Search Conversations Modal */}
      <SearchChatModal
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        conversations={chatList}
        onSelectChat={handleSelectChat}
        onDeleteChat={(chat) => handleDeleteChat(chat.chatId)}
      />
    </>
  );
};

export default SidebarNav;
