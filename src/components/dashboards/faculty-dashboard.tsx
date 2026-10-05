"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlusCircle, ClipboardList, BookOpen, Users, Clock, FileText, Loader2, Sparkles,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface FacultyDashboardProps {
  user: { id: string; email: string; name: string; role: string };
  view: string;
}

export function FacultyDashboard({ user, view }: FacultyDashboardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["faculty-dashboard", user.id],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/faculty");
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (!data) return <div>Failed to load.</div>;

  if (view === "create") return <CreateAssignmentView user={user} courses={data.courses} />;
  if (view === "evaluate") return <EvaluateView data={data} user={user} />;
  if (view === "assignments") return <AssignmentsListView data={data} />;

  // Default dashboard
  const totalAssignments = data.courses?.reduce((a: number, c: any) => a + c.assignments.length, 0) ?? 0;
  const totalStudents = data.courses?.reduce((a: number, c: any) => a + c.studentCount, 0) ?? 0;
  const pendingEvals = data.courses?.reduce(
    (a: number, c: any) => a + c.assignments.reduce((b: number, a2: any) => b + a2.pending, 0),
    0
  ) ?? 0;
  const totalSubs = data.courses?.reduce(
    (a: number, c: any) => a + c.assignments.reduce((b: number, a2: any) => b + a2.totalSubmissions, 0),
    0
  ) ?? 0;

  // Submissions per assignment chart data
  const chartData = data.courses?.flatMap((c: any) =>
    c.assignments.map((a: any) => ({
      name: a.title.split(":")[0].replace("Assignment ", "A"),
      evaluated: a.evaluated,
      pending: a.pending,
    }))
  ) ?? [];

  return (
    <div
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Faculty Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data.courses?.length || 0} courses · {totalAssignments} assignments · {totalStudents} students enrolled
        </p>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Courses" value={data.courses?.length || 0} icon={BookOpen} />
        <MetricCard label="Assignments" value={totalAssignments} icon={FileText} />
        <MetricCard label="Total Submissions" value={totalSubs} icon={Users} />
        <MetricCard label="Pending Evaluation" value={pendingEvals} icon={Clock} tone={pendingEvals > 0 ? "warn" : "neutral"} />
      </div>

      {/* Submissions chart */}
      <Card className="transition-all hover:shadow-md">
        <CardHeader>
          <CardTitle>Submissions Per Assignment</CardTitle>
          <CardDescription>Evaluated vs pending</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13 }} />
                <Bar dataKey="evaluated" stackId="a" fill="#4f46e5" name="Evaluated" radius={[0, 0, 0, 0]} />
                <Bar dataKey="pending" stackId="a" fill="#fbbf24" name="Pending" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Course list with assignment stats */}
      <Card>
        <CardHeader>
          <CardTitle>Courses &amp; Assignments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.courses?.map((c: any) => (
            <div key={c.id} className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-semibold text-slate-900">{c.code} — {c.name}</p>
                  <p className="text-xs text-slate-500">{c.studentCount} students enrolled</p>
                </div>
                <Badge variant="outline" className="bg-slate-50">{c.assignments.length} assignments</Badge>
              </div>
              <div className="space-y-2">
                {c.assignments.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between text-sm py-2 border-t border-slate-100">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-700 truncate">{a.title}</p>
                      <p className="text-xs text-slate-500">
                        Type: {a.type} · Due: {new Date(a.deadline).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
                        {a.evaluated} / {a.totalSubmissions} evaluated
                      </Badge>
                      {a.pending > 0 && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                          {a.pending} pending
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function MetricCard({
  label, value, icon: Icon, tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "warn" | "neutral";
}) {
  const toneClasses = tone === "warn" ? "text-amber-700 bg-amber-50" : "text-indigo-700 bg-indigo-50";
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

// ─────────────────────────────────────────────────────────
function CreateAssignmentView({ user, courses }: { user: any; courses: any[] }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("TEXT");
  const [deadline, setDeadline] = useState("");
  const [courseId, setCourseId] = useState("");
  const [competencyId, setCompetencyId] = useState("");
  const [criteria, setCriteria] = useState([
    { name: "Correctness", description: "Technical accuracy", weight: 0.4, maxScore: 10 },
    { name: "Completeness", description: "All required elements", weight: 0.3, maxScore: 10 },
    { name: "Clarity", description: "Readability", weight: 0.3, maxScore: 10 },
  ]);
  const [saving, setSaving] = useState(false);

  if (!courses?.length) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-slate-500">
          You have no courses assigned. Contact the coordinator to be assigned a course.
        </CardContent>
      </Card>
    );
  }

  const totalWeight = criteria.reduce((a, c) => a + c.weight, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (Math.abs(totalWeight - 1) > 0.001) {
      toast.error("Rubric criteria weights must sum to 1.0");
      return;
    }
    if (!title || !type || !deadline || !courseId) {
      toast.error("Fill in all required fields");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title, type, deadline, courseId, competencyId: competencyId || undefined,
        rubric: { criteria },
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Assignment created");
      setTitle(""); setDeadline("");
    } else {
      toast.error("Failed to create assignment");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <PlusCircle className="h-6 w-6 text-indigo-600" />
          Create Assignment
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Define a new assignment with submission type, deadline, and weighted rubric criteria.
        </p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Assignment 6: ..." />
            </div>
            <div>
              <Label htmlFor="type">Submission Type *</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TEXT">Text</SelectItem>
                  <SelectItem value="IMAGE">Image</SelectItem>
                  <SelectItem value="AUDIO">Audio</SelectItem>
                  <SelectItem value="VIDEO">Video</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="deadline">Deadline *</Label>
              <Input id="deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="course">Course *</Label>
              <Select value={courseId} onValueChange={(v) => { setCourseId(v); setCompetencyId(""); }}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="competency">Linked Competency (CO/PO)</Label>
              <Select value={competencyId} onValueChange={setCompetencyId}>
                <SelectTrigger><SelectValue placeholder="Optional — pick CO/PO" /></SelectTrigger>
                <SelectContent>
                  {courses.find((c: any) => c.id === courseId)?.competencies?.map((comp: any) => (
                    <SelectItem key={comp.id} value={comp.id}>{comp.code} — {comp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Rubric criteria */}
          <div className="border-t border-slate-100 pt-5">
            <div className="flex items-center justify-between mb-3">
              <p className="font-medium text-slate-700">Rubric Criteria</p>
              <Badge variant={Math.abs(totalWeight - 1) < 0.001 ? "outline" : "destructive"}
                className={Math.abs(totalWeight - 1) < 0.001 ? "bg-indigo-50 text-indigo-700 border-indigo-200" : ""}>
                Total weight: {totalWeight.toFixed(2)} {Math.abs(totalWeight - 1) < 0.001 ? "✓" : "(must = 1.0)"}
              </Badge>
            </div>
            <div className="space-y-2">
              {criteria.map((c, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    <Label className="text-xs">Name</Label>
                    <Input value={c.name} onChange={(e) => {
                      const next = [...criteria];
                      next[i].name = e.target.value;
                      setCriteria(next);
                    }} />
                  </div>
                  <div className="col-span-5">
                    <Label className="text-xs">Description</Label>
                    <Input value={c.description} onChange={(e) => {
                      const next = [...criteria];
                      next[i].description = e.target.value;
                      setCriteria(next);
                    }} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Weight (0-1)</Label>
                    <Input type="number" step="0.1" min="0" max="1" value={c.weight} onChange={(e) => {
                      const next = [...criteria];
                      next[i].weight = parseFloat(e.target.value) || 0;
                      setCriteria(next);
                    }} />
                  </div>
                  <div className="col-span-1">
                    <Button variant="ghost" size="sm" type="button" onClick={() => {
                      if (criteria.length === 1) return;
                      setCriteria(criteria.filter((_, j) => j !== i));
                    }} className="text-rose-600 hover:bg-rose-50">✕</Button>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" type="button" onClick={() => setCriteria([...criteria, { name: "New Criterion", description: "", weight: 0, maxScore: 10 }])}
              className="mt-3">+ Add criterion</Button>
          </div>

          <Button onClick={handleSubmit} disabled={saving} className="bg-indigo-600 shadow-sm shadow-indigo-600/20 hover:bg-indigo-700 transition-colors">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : "Create Assignment"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function AssignmentsListView({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-indigo-600" />
          My Assignments
        </h1>
        <p className="text-sm text-muted-foreground mt-1">All assignments you've created across courses.</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-slate-100">
            {data.courses?.flatMap((c: any) =>
              c.assignments.map((a: any) => (
                <div key={a.id} className="p-4 hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-slate-900">{a.title}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {c.code} · Type: {a.type} · Due: {new Date(a.deadline).toLocaleString()}
                      </p>
                    </div>
                    <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
                      {a.evaluated} / {a.totalSubmissions} graded
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
function EvaluateView({ data, user }: { data: any; user: any }) {
  const qc = useQueryClient();
  const [running, setRunning] = useState<string | null>(null);

  async function runAI(submissionId: string) {
    setRunning(submissionId);
    try {
      const r = await fetch(`/api/ai-simulate?submissionId=${submissionId}`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        toast.success(`AI re-run complete · provider: ${j?.provider ?? "MOCK"}`);
        qc.invalidateQueries({ queryKey: ["faculty-dashboard"] });
      } else {
        toast.error(j?.error ?? "AI run failed");
      }
    } catch (e: any) {
      toast.error("AI run failed: " + (e?.message || "unknown"));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-indigo-600" />
          Evaluate Submissions
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Score each rubric criterion for student submissions. Final score = weighted faculty (70%) + peer (30%).
          Use <span className="font-medium">Run AI Analysis</span> to refresh the real-AI similarity + auto-score + feedback for a submission.
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground mb-3">
            The seed data pre-populates all evaluations (faculty + peer) and computes weighted final scores.
            To re-run AI analysis on a specific submission, paste the submission ID below (or use the direct API endpoint).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.courses?.flatMap((c: any) =>
              c.assignments.map((a: any) => (
                <div key={a.id} className="border border-border rounded-lg p-3">
                  <p className="font-medium text-sm text-foreground">{a.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{c.code} · {a.totalSubmissions} submissions</p>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
                      {a.evaluated} graded
                    </Badge>
                    {a.pending > 0 && (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                        {a.pending} pending
                      </Badge>
                    )}
                  </div>
                  <RunAIPanel onRun={runAI} loading={running} />
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RunAIPanel({ onRun, loading }: { onRun: (submissionId: string) => void; loading: string | null }) {
  const [id, setId] = useState("");
  return (
    <div className="mt-3 flex gap-2">
      <Input
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="Submission ID (cuid)"
        className="text-xs h-8"
      />
      <Button
        size="sm"
        className="bg-indigo-600 hover:bg-indigo-700 text-white"
        onClick={() => id && onRun(id)}
        disabled={!id || loading !== null}
      >
        {loading && loading === id ? (
          <><Loader2 className="h-3 w-3 animate-spin" /> Running…</>
        ) : (
          <><Sparkles className="h-3 w-3 mr-1" /> Run AI</>
        )}
      </Button>
    </div>
  );
}
