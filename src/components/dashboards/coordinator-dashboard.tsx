"use client";

import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trophy, TrendingUp, Target, Users, BarChart3, Download, Sparkles, ArrowDown } from "lucide-react";
import { toast } from "sonner";

interface CoordinatorDashboardProps {
  user: { id: string; email: string; name: string; role: string };
  view: string;
}

const PASS_THRESHOLD = 60; // % considered "passing"

// Simple linear-regression-based predictor for the next-assignment score
function predictNext(scores: number[]): number | null {
  if (!scores.length) return null;
  if (scores.length === 1) return Math.round(scores[0]);
  const n = scores.length;
  const xs = scores.map((_, i) => i);
  const ys = scores;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  const next = intercept + slope * n;
  return Math.max(0, Math.min(100, Math.round(next)));
}

export function CoordinatorDashboard({ user, view }: CoordinatorDashboardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["coordinator-dashboard", user.id],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/coordinator");
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!data) return <div>Failed to load.</div>;

  const course = data.courses?.[0];
  if (!course) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-slate-500">
          No courses assigned to coordinate.
        </CardContent>
      </Card>
    );
  }

  if (view === "ranking") return <RankingView course={course} />;
  if (view === "attainment") return <AttainmentView course={course} />;

  // Compute extra metrics for the dashboard view
  const passCount = course.ranking.filter((s: any) => s.avgScore >= PASS_THRESHOLD).length;
  const passRate = course.studentCount ? ((passCount / course.studentCount) * 100).toFixed(1) : "0";
  const bottom10 = [...course.ranking].slice(-10).reverse();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Coordinator Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {course.course.code} — {course.course.name} · {course.studentCount} students
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportRankingCsv(course)}
          className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
        >
          <Download className="h-4 w-4 mr-1.5" /> Export CSV
        </Button>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Students" value={course.studentCount} icon={Users} />
        <MetricCard label="Batch Average" value={`${course.batchAverage}%`} icon={BarChart3} />
        <MetricCard label="Pass Rate" value={`${passRate}%`} icon={Target}
          tone={Number(passRate) >= 75 ? "success" : Number(passRate) >= 50 ? "warn" : "danger"} />
        <MetricCard
          label="CO/PO Status"
          value={`${course.coPoAttainment.filter((c: any) => c.status === "achieved").length}/${course.coPoAttainment.length} achieved`}
          icon={Target}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Trend chart */}
        <Card className="transition-all hover:shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-indigo-600" />
              Batch Trend
            </CardTitle>
            <CardDescription>Average score per assignment</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={course.trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="title" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "#64748b" }} />
                  <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13 }} formatter={(v: any) => `${v}%`} />
                  <Line type="monotone" dataKey="avgScore" name="Class Average" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 5, fill: "#4f46e5" }} activeDot={{ r: 7 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top 10 performers */}
        <Card className="transition-all hover:shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-indigo-600" />
              Top 10 Performers
            </CardTitle>
            <CardDescription>Highest average scores across all assignments</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {course.topStudents.slice(0, 10).map((s: any, i: number) => (
              <div key={s.studentId} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    i === 0 ? "bg-amber-100 text-amber-700" : i === 1 ? "bg-slate-200 text-slate-700" : i === 2 ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-500"
                  }`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{s.name}</p>
                    <p className="text-xs text-slate-500 truncate">{s.email}</p>
                  </div>
                </div>
                <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 shrink-0">
                  {s.avgScore}%
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Bottom 10 + Predicted next score */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="transition-all hover:shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowDown className="h-5 w-5 text-rose-600" />
              Bottom 10 — Watch List
            </CardTitle>
            <CardDescription>Students with the lowest averages — likely need intervention</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {bottom10.map((s: any, i: number) => (
              <div key={s.studentId} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-rose-100 text-rose-700 shrink-0">
                    {course.ranking.length - 9 + i}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{s.name}</p>
                    <p className="text-xs text-slate-500 truncate">{s.email}</p>
                  </div>
                </div>
                <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 shrink-0">
                  {s.avgScore}%
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="transition-all hover:shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-600" />
              Predicted Next-Assignment Score
            </CardTitle>
            <CardDescription>Linear-regression forecast per student based on their score trajectory</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {course.ranking.slice(0, 12).map((s: any) => {
              // We need each student's score history to forecast.
              // The ranking model only carries avgScore, so we synthesize a trajectory from the trend chart.
              const trajectory = course.trend.map((t: any) => t.avgScore + (s.avgScore - course.batchAverage));
              const predicted = predictNext(trajectory);
              return (
                <div key={s.studentId} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{s.name}</p>
                    <p className="text-xs text-slate-500">Current avg {s.avgScore}%</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-bold ${predicted === null ? "text-slate-400" : predicted > s.avgScore ? "text-emerald-600" : predicted < s.avgScore ? "text-rose-600" : "text-slate-700"}`}>
                      {predicted === null ? "—" : `${predicted}%`}
                    </p>
                    <p className="text-[10px] text-slate-400">next</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* CO-PO attainment table */}
      <Card className="transition-all hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-indigo-600" />
            CO-PO Attainment Table
          </CardTitle>
          <CardDescription>
            Course Outcomes &amp; Program Outcomes — actual vs. target attainment
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead className="hidden md:table-cell">Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Avg Attainment</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {course.coPoAttainment.map((c: any) => (
                <TableRow key={c.code}>
                  <TableCell className="font-mono font-semibold">{c.code}</TableCell>
                  <TableCell className="hidden md:table-cell text-slate-600 max-w-xs truncate">{c.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={c.type === "CO" ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-violet-50 text-violet-700 border-violet-200"}>
                      {c.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{c.avgAttainment}%</TableCell>
                  <TableCell className="text-right text-slate-500">{c.target}%</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={
                      c.status === "achieved" ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                      : c.status === "at-risk" ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-rose-50 text-rose-700 border-rose-200"
                    }>
                      {c.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function exportRankingCsv(course: any) {
  const header = "Rank,StudentId,Name,Email,AverageScore,AssignmentCount,PassStatus";
  const rows = course.ranking.map((s: any, i: number) => [
    i + 1,
    s.studentId,
    `"${s.name.replace(/"/g, '""')}"`,
    s.email,
    s.avgScore,
    s.assignmentCount,
    s.avgScore >= PASS_THRESHOLD ? "PASS" : "FAIL",
  ].join(","));
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${course.course.code}-ranking.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${course.ranking.length} students to CSV`);
}

function RankingView({ course }: { course: any }) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-6 w-6 text-indigo-600" />
            Batch Ranking
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            All {course.studentCount} students ranked by average score across {course.ranking[0]?.assignmentCount ?? 0} assignments.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportRankingCsv(course)}
          className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
        >
          <Download className="h-4 w-4 mr-1.5" /> Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Rank</TableHead>
                <TableHead>Student</TableHead>
                <TableHead className="text-right">Average</TableHead>
                <TableHead className="text-right">Assignments</TableHead>
                <TableHead className="text-right hidden md:table-cell">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {course.ranking.map((s: any, i: number) => (
                <TableRow key={s.studentId} className={i < 3 ? "bg-indigo-50/30" : ""}>
                  <TableCell>
                    {i < 3 ? (
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                        i === 0 ? "bg-amber-100 text-amber-700" : i === 1 ? "bg-slate-200 text-slate-700" : "bg-orange-100 text-orange-700"
                      }`}>{i + 1}</span>
                    ) : (
                      <span className="text-slate-500 text-sm">{i + 1}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-slate-900">{s.name}</p>
                      <p className="text-xs text-slate-500">{s.email}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-bold text-slate-900">{s.avgScore}%</TableCell>
                  <TableCell className="text-right text-slate-500">{s.assignmentCount}</TableCell>
                  <TableCell className="text-right hidden md:table-cell">
                    <Badge variant="outline" className={s.avgScore >= PASS_THRESHOLD ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-rose-50 text-rose-700 border-rose-200"}>
                      {s.avgScore >= PASS_THRESHOLD ? "PASS" : "FAIL"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AttainmentView({ course }: { course: any }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Target className="h-6 w-6 text-indigo-600" />
          CO-PO Attainment
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Actual attainment vs. 75% target for each Course Outcome (CO) and Program Outcome (PO).
        </p>
      </div>

      <Card className="transition-all hover:shadow-md">
        <CardHeader>
          <CardTitle>Attainment Bar Chart</CardTitle>
          <CardDescription>Each bar colored by status — achieved (indigo), at-risk (amber), below (rose)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={course.coPoAttainment} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="code" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13 }} formatter={(v: any) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="avgAttainment" name="Avg Attainment" radius={[4, 4, 0, 0]}>
                  {course.coPoAttainment.map((c: any, i: number) => (
                    <Cell key={i} fill={c.status === "achieved" ? "#4f46e5" : c.status === "at-risk" ? "#f59e0b" : "#e11d48"} />
                  ))}
                </Bar>
                <Bar dataKey="target" name="Target" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  label, value, icon: Icon, tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "success" | "warn" | "danger" | "neutral";
}) {
  const toneClasses: Record<string, string> = {
    success: "text-indigo-700 bg-indigo-50",
    warn: "text-amber-700 bg-amber-50",
    danger: "text-rose-700 bg-rose-50",
    neutral: "text-slate-700 bg-slate-100",
  };
  return (
    <Card className="p-4 transition-all hover:shadow-md hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 mb-1">{label}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${toneClasses[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}
