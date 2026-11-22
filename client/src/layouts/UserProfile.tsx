import React, { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { ChevronsUpDown, Settings, LogOut, User, Sparkles, LogIn } from "lucide-react";
import { Show, useUser, useClerk } from "@clerk/react";
import { cn } from "../utils/cn";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

interface UserProfileProps {
  isCollapsed?: boolean;
  className?: string;
}

const ClerkProfileContent: React.FC<{ isCollapsed: boolean; className?: string }> = ({
  isCollapsed,
  className,
}) => {
  const { user } = useUser();
  const { openUserProfile, signOut } = useClerk();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const displayName = user?.fullName || user?.firstName || "Matrix User";
  const displayEmail = user?.primaryEmailAddress?.emailAddress || "";
  const avatarUrl = user?.imageUrl;
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <div className={cn("relative p-2", className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="User account menu"
        className={cn(
          "group flex w-full items-center rounded-lg p-2 text-left text-sm transition-colors duration-150 outline-none",
          "hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          isOpen && "bg-accent/80",
          isCollapsed ? "justify-center p-1.5" : "justify-between"
        )}
      >
        <div
          className={cn(
            "flex items-center min-w-0",
            isCollapsed ? "justify-center" : "gap-2.5"
          )}
        >
          <div className="relative flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg bg-primary text-primary-foreground font-semibold text-xs shadow-sm ring-1 ring-border overflow-hidden">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="h-full w-full rounded-lg object-cover"
              />
            ) : (
              <span>{initials}</span>
            )}
          </div>

          {!isCollapsed && (
            <div className="flex flex-col min-w-0 text-left">
              <span className="truncate font-medium text-foreground leading-tight text-xs">
                {displayName}
              </span>
              <span className="truncate text-[11px] text-muted-foreground leading-tight mt-0.5">
                {displayEmail}
              </span>
            </div>
          )}
        </div>

        {!isCollapsed && (
          <ChevronsUpDown
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:text-foreground"
            aria-hidden="true"
          />
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-orientation="vertical"
          className={cn(
            "absolute z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95 duration-150",
            isCollapsed
              ? "left-full bottom-2 ml-2 w-56"
              : "bottom-full left-2 right-2 mb-2"
          )}
        >
          {/* Header */}
          <div className="border-b border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary text-[10px] font-bold">
                {initials}
              </span>
              <div className="flex flex-col overflow-hidden">
                <span className="truncate text-xs font-semibold text-foreground">
                  {displayName}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {displayEmail}
                </span>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between rounded bg-muted/60 px-2 py-1 text-[10px] font-medium text-muted-foreground">
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-amber-500" />
                Clerk Authenticated
              </span>
            </div>
          </div>

          {/* Action items */}
          <div className="p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                openUserProfile();
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground outline-none focus:bg-accent"
            >
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Account Profile</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                openUserProfile();
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground outline-none focus:bg-accent"
            >
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Security & Settings</span>
            </button>
          </div>

          {/* Logout */}
          <div className="border-t border-border p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                signOut();
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 outline-none focus:bg-destructive/10"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Log out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const UserProfile: React.FC<UserProfileProps> = ({
  isCollapsed = false,
  className,
}) => {
  // If Clerk Publishable Key is present, render Clerk auth components
  if (PUBLISHABLE_KEY) {
    return (
      <>
        <Show when="signed-in">
          <ClerkProfileContent isCollapsed={isCollapsed} className={className} />
        </Show>
        <Show when="signed-out">
          <div className={cn("p-2", className)}>
            <Link
              to="/login"
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2 px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-ring shadow-sm",
                isCollapsed && "px-1.5"
              )}
            >
              <LogIn className="h-4 w-4 shrink-0" />
              {!isCollapsed && <span>Sign In</span>}
            </Link>
          </div>
        </Show>
      </>
    );
  }

  // Fallback if no Clerk key is set yet
  return (
    <div className={cn("relative p-2", className)}>
      <div
        className={cn(
          "flex items-center rounded-lg p-2 text-xs text-muted-foreground",
          isCollapsed ? "justify-center" : "gap-2"
        )}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted font-medium text-foreground">
          AK
        </div>
        {!isCollapsed && (
          <div className="flex flex-col">
            <span className="font-medium text-foreground">Setup Clerk</span>
            <span className="text-[10px]">Add VITE_CLERK_PUBLISHABLE_KEY</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserProfile;
