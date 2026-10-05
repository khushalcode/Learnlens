"use client";

import { useQuery } from "@tanstack/react-query";

import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, BookOpen, FileText, ClipboardList, MessageSquare, Shield, HardDrive, Bell } from "lucide-react";

interface AdminDashboardProps {
  user: { id: string; email: string; name: string; role: string };
  view: string;
}

const PIE_COLORS = ["#4f46e5", "#7c3aed", "#a78bfa", "#5b21b6", "#4338ca"];

export function AdminDashboard({ user, view }: AdminDashboardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/admin");
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!data) return <div>Failed to load.</div>;

  const pieData = data.usersByRole?.map((u: any) => ({
    name: u.role,
    value: u._count ?? u.count,
  })) ?? [];

  return (
    <div
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="h-6 w-6 text-indigo-600" />
          Admin Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          System-wide overview of users, courses, and submissions.
        </p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <MetricCard label="Total Users" value={data.totals.users} icon={Users} />
        <MetricCard label="Courses" value={data.totals.courses} icon={BookOpen} />
        <MetricCard label="Assignments" value={data.totals.assignments} icon={FileText} />
        <MetricCard label="Submissions" value={data.totals.submissions} icon={ClipboardList} />
        <MetricCard label="Evaluations" value={data.totals.evaluations} icon={ClipboardList} />
        <MetricCard label="Feedback Items" value={data.totals.feedback} icon={MessageSquare} />
      </div>

      {/* Storage + Notifications (Feature 1 + Feature 4) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 transition-all hover:shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-indigo-600" />
              Supabase-Style Storage Stats
            </CardTitle>
            <CardDescription>Files uploaded through the new submission flow (live stats from /upload)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="Total Files" value={data.storage?.fileCount ?? 0} />
              <Stat label="Storage Used" value={`${data.storage?.sizeMB ?? 0} MB`} />
              <Stat label="Submissions Bucket" value={data.storage?.perBucket?.submissions?.count ?? 0} />
              <Stat label="Avatars Bucket" value={data.storage?.perBucket?.avatars?.count ?? 0} />
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Files served from <code className="bg-muted px-1 rounded">/api/storage/[...path]</code> · RLS enforced per route
            </div>
          </CardContent>
        </Card>
        <Card className="transition-all hover:shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-indigo-600" />
              Notifications
            </CardTitle>
            <CardDescription>Total in-app notifications generated</CardDescription>
          </CardHeader>
          <CardContent>
            <Stat label="Total Notifications" value={data.totals.notifications ?? 0} />
            <div className="mt-3 text-xs text-muted-foreground">
              Fired on: assignment created · result published · peer review assigned · AI analysis ready · deadline reminders
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Users by role pie chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="transition-all hover:shadow-md">
          <CardHeader>
            <CardTitle>Users by Role</CardTitle>
            <CardDescription>Distribution across the 5 system roles</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e: any) => `${e.name}: ${e.value}`}>
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Role Breakdown</CardTitle>
            <CardDescription>Headcount by role</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">% of Users</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.usersByRole?.map((r: any) => {
                  const count = r._count ?? r.count;
                  const pct = data.totals.users ? ((count / data.totals.users) * 100).toFixed(1) : 0;
                  return (
                    <TableRow key={r.role}>
                      <TableCell>
                        <Badge variant="outline" className="bg-slate-50 capitalize">{r.role.toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-bold">{count}</TableCell>
                      <TableCell className="text-right text-slate-500">{pct}%</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  label, value, icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="p-4 transition-all hover:shadow-md hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 mb-1">{label}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-indigo-700 bg-indigo-50">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-3 rounded-lg bg-muted/60">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}
