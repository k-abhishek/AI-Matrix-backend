import React, { useState, useMemo } from "react";
import { Search, X, MessageSquare, ArrowRight, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { Input } from "../ui/input";
import type { ChatThread } from "../../types";

interface SearchChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: ChatThread[];
  onSelectChat: (chatId: string) => void;
  onDeleteChat?: (chat: { chatId: string; title: string }) => void;
}

export const SearchChatModal: React.FC<SearchChatModalProps> = ({
  open,
  onOpenChange,
  conversations,
  onSelectChat,
  onDeleteChat,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((chat) => {
      const title = chat.title?.toLowerCase() || "";
      const chatId = chat.chatId?.toLowerCase() || "";
      return title.includes(query) || chatId.includes(query);
    });
  }, [conversations, searchQuery]);

  const handleSelect = (chatId: string) => {
    onSelectChat(chatId);
    onOpenChange(false);
    setSearchQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 overflow-hidden border border-border shadow-xl">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-base font-semibold">
            Search Conversations
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Search through all your previous chats and select one to resume.
          </DialogDescription>
        </DialogHeader>

        {/* Search bar on top */}
        <div className="px-4 pb-3">
          <div className="relative flex items-center">
            <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
            <Input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations by title..."
              className="w-full h-10 pl-9 pr-9 text-sm bg-muted/60"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 p-0.5 rounded text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* List of conversations below */}
        <div className="max-h-80 overflow-y-auto px-2 pb-3 space-y-1 border-t border-border/50 pt-4">
          {filteredConversations.length > 0 ? (
            filteredConversations.map((chat) => (
              <div
                key={chat.chatId}
                onClick={() => handleSelect(chat.chatId)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left text-sm hover:bg-accent/80 hover:text-accent-foreground transition-colors group cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                    <MessageSquare className="h-3.5 w-3.5" />
                  </div>
                  <span className="truncate font-medium text-foreground text-xs md:text-sm">
                    {chat.title || "Untitled Conversation"}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {onDeleteChat && (
                    <button
                      type="button"
                      title="Delete conversation"
                      aria-label="Delete conversation"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteChat({
                          chatId: chat.chatId,
                          title: chat.title || "Untitled Conversation",
                        });
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-all" />
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {searchQuery ? (
                <span>
                  No conversations found matching &quot;{searchQuery}&quot;
                </span>
              ) : (
                <span>No conversations recorded yet.</span>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SearchChatModal;
