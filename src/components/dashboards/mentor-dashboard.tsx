"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  TrendingUp, TrendingDown, AlertTriangle, Users, Activity, Minus,
} from "lucide-react";

interface MentorDashboardProps {
  user: { id: string; email: string; name: string; role: string };
  view: string;
}

export function MentorDashboard({ user, view }: MentorDashboardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["mentor-dashboard", user.id],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/mentor");
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!data) return <div>Failed to load.</div>;

  const atRiskMentees = data.mentees?.filter((m: any) => m.atRisk) ?? [];
  const activeMentees = data.mentees?.filter((m: any) => !m.atRisk) ?? [];

  const showAtRisk = view === "atrisk";

  return (
    <div
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {showAtRisk ? "At-Risk Mentees" : "Mentor Dashboard"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data.totalMentees} mentees · {data.atRiskCount} flagged at-risk
          {showAtRisk && " (last 2 scores dropped)"}
        </p>
      </div>

      {!showAtRisk && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <MetricCard label="Total Mentees" value={data.totalMentees} icon={Users} />
          <MetricCard label="At-Risk" value={data.atRiskCount} icon={AlertTriangle} tone="warn" />
          <MetricCard label="Healthy" value={data.totalMentees - data.atRiskCount} icon={Activity} tone="success" />
        </div>
      )}

      <Card className="transition-all hover:shadow-md">
        <CardHeader>
          <CardTitle>{showAtRisk ? "Students Needing Intervention" : "Mentee Overview"}</CardTitle>
          <CardDescription>
            {showAtRisk
              ? "These students have declining performance in their last 2 assignments — schedule a check-in."
              : "Per-student score trends. At-risk flag triggers when last 2 scores both dropped."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(showAtRisk ? atRiskMentees : data.mentees)?.map((m: any) => (
            <MenteeCard key={m.id} mentee={m} expanded={showAtRisk} />
          ))}
          {showAtRisk && !atRiskMentees.length && (
            <div className="flex flex-col items-center justify-center text-center py-10 px-4">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
                <Activity className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="text-sm font-medium text-slate-700">No at-risk students</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">All your mentees are progressing well — no intervention needed right now.</p>
            </div>
          )}
          {!showAtRisk && !data.mentees?.length && (
            <div className="flex flex-col items-center justify-center text-center py-10 px-4">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                <Users className="h-6 w-6 text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-700">No mentees assigned</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">You don't have any students assigned as your mentees yet.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MenteeCard({ mentee, expanded }: { mentee: any; expanded: boolean }) {
  // Build chart data: score per assignment
  const chartData = mentee.scores.map((s: any, i: number) => ({
    name: s.assignmentTitle.split(":")[0].replace("Assignment ", "A"),
    score: s.score,
  }));

  return (
    <div className={`border rounded-lg p-4 transition-all hover:shadow-md ${mentee.atRisk ? "border-rose-200 bg-rose-50/30" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback className={mentee.atRisk ? "bg-rose-100 text-rose-700" : "bg-indigo-100 text-indigo-700"}>
              {mentee.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-slate-900">{mentee.name}</p>
            <p className="text-xs text-slate-500">{mentee.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {mentee.atRisk && (
            <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">
              <AlertTriangle className="h-3 w-3 mr-1" /> At-Risk
            </Badge>
          )}
          <Badge variant="outline" className="bg-slate-50">
            Avg: {mentee.avgScore}%
          </Badge>
          <Badge variant="outline" className={
            mentee.trend === "up" ? "bg-indigo-50 text-indigo-700 border-indigo-200"
            : mentee.trend === "down" ? "bg-rose-50 text-rose-700 border-rose-200"
            : "bg-slate-50"
          }>
            {mentee.trend === "up" ? <TrendingUp className="h-3 w-3 mr-1" /> :
             mentee.trend === "down" ? <TrendingDown className="h-3 w-3 mr-1" /> :
             <Minus className="h-3 w-3 mr-1" />}
            {mentee.trend}
          </Badge>
        </div>
      </div>

      {(expanded || mentee.atRisk) && chartData.length > 0 && (
        <div className="h-40 mt-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} formatter={(v: any) => `${v}%`} />
              <Line type="monotone" dataKey="score" stroke={mentee.atRisk ? "#e11d48" : "#4f46e5"} strokeWidth={2} dot={{ r: 4, fill: mentee.atRisk ? "#e11d48" : "#4f46e5" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {!expanded && !mentee.atRisk && (
        <p className="text-xs text-slate-500">
          Last score: {mentee.scores[mentee.scores.length - 1]?.score ?? "—"}%
          {" · "}{mentee.scores.length} assignments submitted
        </p>
      )}

      {mentee.atRisk && (
        <CounselingNoteForm mentee={mentee} />
      )}
    </div>
  );
}

function MetricCard({
  label, value, icon: Icon, tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "success" | "warn" | "neutral";
}) {
  const toneClasses = {
    success: "text-indigo-700 bg-indigo-50",
    warn: "text-rose-700 bg-rose-50",
    neutral: "text-slate-700 bg-slate-100",
  }[tone];
  return (
    <Card className="p-4 transition-all hover:shadow-md hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 mb-1">{label}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${toneClasses}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function CounselingNoteForm({ mentee }: { mentee: any }) {
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <div className="mt-3 border-t border-rose-100 pt-3">
      <label className="text-xs font-medium text-slate-700 block mb-1.5">
        Counseling note
      </label>
      <div className="flex gap-2">
        <input
          value={note}
          onChange={(e) => { setNote(e.target.value); setSaved(false); }}
          placeholder="e.g. Scheduled 1-on-1 for next Tuesday — focus on Assignment 6 fundamentals."
          className="flex-1 px-3 py-1.5 text-sm rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
        />
        <button
          onClick={() => { if (note.trim()) { setSaved(true); toast.success(`Counseling note saved for ${mentee.name}`); } }}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-700 transition-colors"
        >
          Save
        </button>
      </div>
      {saved && (
        <p className="text-[11px] text-emerald-600 mt-1">✓ Note saved. A reminder has been added to your tasks.</p>
      )}
    </div>
  );
}
