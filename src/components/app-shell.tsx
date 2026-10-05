"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GraduationCap, LogOut, Menu, X,
  LayoutDashboard, FileText, Upload, BarChart3, Users, ClipboardList,
  TrendingUp, Trophy, Target, PlusCircle, BookOpen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationsBell } from "@/components/notifications-bell";
import { StudentDashboard } from "@/components/dashboards/student-dashboard";
import { FacultyDashboard } from "@/components/dashboards/faculty-dashboard";
import { MentorDashboard } from "@/components/dashboards/mentor-dashboard";
import { CoordinatorDashboard } from "@/components/dashboards/coordinator-dashboard";
import { AdminDashboard } from "@/components/dashboards/admin-dashboard";

type View = string;

interface NavItem {
  id: View;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ROLE_LABELS: Record<string, string> = {
  STUDENT: "Student",
  FACULTY: "Faculty",
  MENTOR: "Mentor",
  COORDINATOR: "Course Coordinator",
  ADMIN: "Administrator",
};

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  STUDENT: [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "submissions", label: "My Submissions", icon: FileText },
    { id: "submit", label: "Submit Work", icon: Upload },
    { id: "insights", label: "AI Insights", icon: BarChart3 },
  ],
  FACULTY: [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "assignments", label: "My Assignments", icon: BookOpen },
    { id: "create", label: "Create Assignment", icon: PlusCircle },
    { id: "evaluate", label: "Evaluate", icon: ClipboardList },
  ],
  MENTOR: [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "mentees", label: "My Mentees", icon: Users },
    { id: "atrisk", label: "At-Risk", icon: TrendingUp },
  ],
  COORDINATOR: [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "ranking", label: "Rankings", icon: Trophy },
    { id: "attainment", label: "CO-PO Attainment", icon: Target },
  ],
  ADMIN: [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "users", label: "Users", icon: Users },
    { id: "courses", label: "Courses", icon: BookOpen },
  ],
};

export function AppShell({ user }: { user: { id: string; email: string; name: string; role: string } }) {
  const [view, setView] = useState<View>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const nav = NAV_BY_ROLE[user.role] ?? [];
  const roleLabel = ROLE_LABELS[user.role] ?? user.role;

  // Notification link parser — links look like "submit:" / "submissions:" /
  // "evaluate:" / "insights:" / "assignments:abc123" (left of ":" = view id,
  // right = optional context). We just switch to the matching view id.
  function handleNotifNavigate(link: string | null) {
    if (!link) return;
    const viewId = link.split(":")[0];
    if (!viewId) return;
    // Only switch if the role has this view in their nav.
    const allowed = (NAV_BY_ROLE[user.role] ?? []).some((n) => n.id === viewId);
    if (allowed) {
      setView(viewId);
      setSidebarOpen(false);
    } else {
      // Fall back to dashboard if the role can't see the linked view.
      setView("dashboard");
      setSidebarOpen(false);
    }
  }

  function renderView() {
    const commonProps = { user, view };
    switch (user.role) {
      case "STUDENT":
        return <StudentDashboard {...commonProps} />;
      case "FACULTY":
        return <FacultyDashboard {...commonProps} />;
      case "MENTOR":
        return <MentorDashboard {...commonProps} />;
      case "COORDINATOR":
        return <CoordinatorDashboard {...commonProps} />;
      case "ADMIN":
        return <AdminDashboard {...commonProps} />;
      default:
        return <div>Unknown role</div>;
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 bg-card border-b border-border px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 rounded-md hover:bg-muted"
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-sm shadow-indigo-600/30">
              <GraduationCap className="h-4 w-4" />
            </div>
            <span className="font-semibold">LearnLens</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-muted text-muted-foreground">{roleLabel}</Badge>
          <NotificationsBell
            onNavigate={(link) => handleNotifNavigate(link)}
            className="h-9 w-9"
          />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside
          className={`fixed lg:sticky top-0 left-0 z-40 lg:z-auto h-screen lg:h-screen w-64 shrink-0 bg-card border-r border-border transition-transform duration-200 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="flex flex-col h-full">
            {/* Sidebar header */}
            <div className="h-14 flex items-center justify-between px-4 border-b border-border/60">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-sm shadow-indigo-600/30">
                  <GraduationCap className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-bold text-sm leading-tight text-foreground">LearnLens</div>
                  <div className="text-[10px] text-muted-foreground leading-tight">Learning Analytics</div>
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden p-1 rounded hover:bg-muted"
                aria-label="Close sidebar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* User card */}
            <div className="px-3 py-3 border-b border-border/60">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-sm font-semibold">
                  {user.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate text-foreground">{user.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                </div>
              </div>
              <Badge variant="outline" className="mt-2 bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900 text-[10px] font-medium">
                {roleLabel}
              </Badge>
            </div>

            {/* Nav */}
            <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
              {nav.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setView(item.id);
                      setSidebarOpen(false);
                    }}
                    className={`group relative w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      active
                        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    aria-current={active ? "page" : undefined}
                  >
                    {active && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-indigo-600"
                        aria-hidden
                      />
                    )}
                    <Icon className={`h-4 w-4 ${active ? "text-indigo-600 dark:text-indigo-400" : ""}`} />
                    {item.label}
                  </button>
                );
              })}
            </nav>

            {/* Logout */}
            <div className="p-2 border-t border-border/60 flex items-center gap-2">
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="flex-1 flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30 dark:hover:text-rose-300 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
              <NotificationsBell
                onNavigate={(link) => handleNotifNavigate(link)}
                className="h-9 w-9 hidden lg:flex"
              />
              <div className="hidden lg:block">
                <ThemeToggle />
              </div>
            </div>
          </div>
        </aside>

        {/* Overlay for mobile */}
        {sidebarOpen && (
          <div
            className="lg:hidden fixed inset-0 bg-slate-900/40 z-30 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                {renderView()}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
