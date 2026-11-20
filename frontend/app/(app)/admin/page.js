"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronRight,
  ListOrdered,
  Search,
  Shield,
  Users,
  Wallet,
} from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
} from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SegmentedControl } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi, useDebouncedValue } from "@/lib/hooks";
import { ORDER_STATUS } from "@/lib/constants";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPrice,
  formatQuantity,
  formatRelative,
} from "@/lib/format";
import { useSession } from "@/store/use-session";
import { adminApi } from "@/lib/endpoints";

function AdminUsers() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("ALL");
  const [suspended, setSuspended] = useState("ALL");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const debounced = useDebouncedValue(search, 300);

  const { data, loading, error, mutate } = useApi("/admin/users", {
    query: {
      page,
      limit: 20,
      search: debounced || undefined,
      role: role === "ALL" ? undefined : role,
      isSuspended: suspended === "ALL" ? undefined : suspended === "YES",
    },
  });
  const users = data?.users ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-[240px]">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search name or email"
            inputSize="sm"
            leftIcon={<Search className="size-3.5" />}
          />
        </div>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="h-8 w-[130px] text-[11.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All roles</SelectItem>
            <SelectItem value="TRADER">Trader</SelectItem>
            <SelectItem value="MODERATOR">Moderator</SelectItem>
            <SelectItem value="ADMIN">Admin</SelectItem>
          </SelectContent>
        </Select>
        <Select value={suspended} onValueChange={setSuspended}>
          <SelectTrigger className="h-8 w-[140px] text-[11.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Any status</SelectItem>
            <SelectItem value="NO">Active</SelectItem>
            <SelectItem value="YES">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-[10.5px] text-fg-subtle">
          {pagination?.total ? `${pagination.total} users` : "—"}
        </span>
      </div>

      <Card>
        <DataTable
          caption="Admin users"
          loading={loading && !users.length}
          rows={users}
          onRowClick={(row) => setSelectedId(row.id)}
          empty={
            error ? (
              <ErrorState compact code={error.code} title="Could not load users" description={error.message} />
            ) : (
              <EmptyState compact icon={Users} title="No users found" description="Adjust the search or filters." />
            )
          }
          columns={[
            {
              key: "name",
              header: "User",
              render: (row) => (
                <div className="flex items-center gap-2.5">
                  <Avatar src={row.avatarUrl} name={row.name} size={28} />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-fg">{row.name}</p>
                    <p className="truncate text-[10px] text-fg-subtle">{row.email}</p>
                  </div>
                </div>
              ),
            },
            {
              key: "role",
              header: "Role",
              render: (row) => (
                <Badge tone={row.role === "ADMIN" ? "violet" : row.role === "MODERATOR" ? "info" : "neutral"}>
                  {row.role}
                </Badge>
              ),
            },
            {
              key: "isVerified",
              header: "Verified",
              render: (row) => (row.isVerified ? "Yes" : "No"),
            },
            {
              key: "isSuspended",
              header: "Status",
              render: (row) =>
                row.isSuspended ? (
                  <Badge tone="down" dot> Suspended </Badge>
                ) : (
                  <Badge tone="up" dot> Active </Badge>
                ),
            },
            {
              key: "lastLoginAt",
              header: "Last login",
              align: "right",
              render: (row) =>
                row.lastLoginAt ? formatRelative(row.lastLoginAt) : "Never",
            },
            {
              key: "createdAt",
              header: "Joined",
              align: "right",
              render: (row) => formatDate(row.createdAt),
            },
            {
              key: "arrow",
              header: "",
              align: "right",
              render: () => <ChevronRight className="ml-auto size-3.5 text-fg-subtle" />,
            },
          ]}
          footer={
            <Pagination
              page={pagination?.page || page}
              totalPages={pagination?.totalPages || 1}
              total={pagination?.total}
              limit={pagination?.limit || 20}
              onPageChange={setPage}
            />
          }
        />
      </Card>

      <AdminUserDetail
        userId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdated={() => mutate()}
      />
    </div>
  );
}

function AdminUserDetail({ userId, onClose, onUpdated }) {
  const [updating, setUpdating] = useState(false);
  const { data, loading, error, mutate } = useApi(
    userId ? `/admin/users/${userId}` : null,
    { enabled: Boolean(userId) },
  );
  const user = data?.user;

  async function changeSuspension() {
    const isSuspended = !user.isSuspended;
    const action = isSuspended ? "Suspend" : "Unsuspend";
    if (!window.confirm(`${action} ${user.name} (${user.email})?`)) return;
    const reason = window.prompt("Enter a reason (required, up to 500 characters):")?.trim();
    if (!reason) {
      toast.error("A reason is required.");
      return;
    }
    if (reason.length > 500) {
      toast.error("Reason must be 500 characters or less.");
      return;
    }
    setUpdating(true);
    try {
      await adminApi.setUserSuspension(user.id, { isSuspended, reason });
      await Promise.all([mutate(), onUpdated()]);
      toast.success(`Account ${isSuspended ? "suspended" : "unsuspended"}.`);
    } catch (requestError) {
      toast.error("Account status was not changed.", {
        description: requestError?.message || "Please try again.",
      });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <Dialog open={Boolean(userId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>User detail</DialogTitle>
          <DialogDescription>Account details and status controls.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {loading && !user ? (
            <p className="text-[12px] text-fg-subtle">Loading…</p>
          ) : error ? (
            <ErrorState compact code={error.code} title="Could not load user" description={error.message} />
          ) : user ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar src={user.avatarUrl} name={user.name} size={48} />
                <div>
                  <p className="text-[14px] font-semibold text-fg">{user.name}</p>
                  <p className="text-[11px] text-fg-subtle">{user.email}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["ID", user.id],
                  ["Role", user.role],
                  ["Verified", user.isVerified ? "Yes" : "No"],
                  ["Suspended", user.isSuspended ? "Yes" : "No"],
                  ["Joined", formatDate(user.createdAt)],
                  ["Last login", user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[8px] border border-line bg-surface-2/50 px-2.5 py-2">
                    <p className="text-[9px] uppercase tracking-[0.07em] text-fg-subtle">{label}</p>
                    <p className="mt-0.5 truncate font-mono text-[10.5px] text-fg">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {user ? (
            <Button
              variant={user.isSuspended ? "success" : "danger"}
              onClick={changeSuspension}
              loading={updating}
              disabled={updating}
            >
              {user.isSuspended ? "Unsuspend account" : "Suspend account"}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={updating}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdminPortfolios() {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("ALL");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const debounced = useDebouncedValue(search, 300);

  const { data, loading, error } = useApi("/admin/portfolios", {
    query: {
      page,
      limit: 20,
      search: debounced || undefined,
      isActive: active === "ALL" ? undefined : active === "YES",
    },
  });
  const portfolios = data?.portfolios ?? [];
  const pagination = data?.pagination;

  const { data: detailData } = useApi(
    selectedId ? `/admin/portfolios/${selectedId}` : null,
    { enabled: Boolean(selectedId) },
  );
  const detail = detailData?.portfolio;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-[260px]">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search portfolio or owner"
            inputSize="sm"
            leftIcon={<Search className="size-3.5" />}
          />
        </div>
        <Select value={active} onValueChange={setActive}>
          <SelectTrigger className="h-8 w-[140px] text-[11.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Any status</SelectItem>
            <SelectItem value="YES">Active</SelectItem>
            <SelectItem value="NO">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-[10.5px] text-fg-subtle">
          {pagination?.total ? `${pagination.total} portfolios` : "—"}
        </span>
      </div>

      <Card>
        <DataTable
          caption="Admin portfolios"
          loading={loading && !portfolios.length}
          rows={portfolios}
          onRowClick={(row) => setSelectedId(row.id)}
          empty={
            error ? (
              <ErrorState compact code={error.code} title="Could not load portfolios" description={error.message} />
            ) : (
              <EmptyState compact icon={Wallet} title="No portfolios found" description="Adjust the search or filters." />
            )
          }
          columns={[
            {
              key: "name",
              header: "Portfolio",
              render: (row) => (
                <div>
                  <p className="text-[12px] font-medium text-fg">{row.name}</p>
                  <p className="text-[10px] text-fg-subtle">{row.id.slice(0, 8)}…</p>
                </div>
              ),
            },
            {
              key: "owner",
              header: "Owner",
              render: (row) => (
                <div>
                  <p className="text-[11.5px] text-fg">{row.owner?.name}</p>
                  <p className="text-[10px] text-fg-subtle">{row.owner?.email}</p>
                </div>
              ),
            },
            {
              key: "cashBalance",
              header: "Cash",
              align: "right",
              render: (row) => formatCurrency(row.cashBalance),
            },
            {
              key: "startingBalance",
              header: "Starting",
              align: "right",
              render: (row) => formatCurrency(row.startingBalance),
            },
            {
              key: "isActive",
              header: "Status",
              render: (row) =>
                row.isActive ? <Badge tone="up" dot> Active </Badge> : <Badge tone="neutral"> Inactive </Badge>,
            },
            {
              key: "createdAt",
              header: "Created",
              align: "right",
              render: (row) => formatDate(row.createdAt),
            },
            {
              key: "arrow",
              header: "",
              align: "right",
              render: () => <ChevronRight className="ml-auto size-3.5 text-fg-subtle" />,
            },
          ]}
          footer={
            <Pagination
              page={pagination?.page || page}
              totalPages={pagination?.totalPages || 1}
              total={pagination?.total}
              limit={pagination?.limit || 20}
              onPageChange={setPage}
            />
          }
        />
      </Card>

      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Portfolio detail</DialogTitle>
            <DialogDescription>Read-only portfolio projection.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {detail ? (
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["ID", detail.id],
                  ["Name", detail.name],
                  ["Owner", detail.owner?.name],
                  ["Email", detail.owner?.email],
                  ["Cash", formatCurrency(detail.cashBalance)],
                  ["Starting", formatCurrency(detail.startingBalance)],
                  ["Default", detail.isDefault ? "Yes" : "No"],
                  ["Active", detail.isActive ? "Yes" : "No"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[8px] border border-line bg-surface-2/50 px-2.5 py-2">
                    <p className="text-[9px] uppercase tracking-[0.07em] text-fg-subtle">{label}</p>
                    <p className="mt-0.5 truncate text-[10.5px] text-fg">{value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-fg-subtle">Loading…</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelectedId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdminOrders() {
  const [status, setStatus] = useState("ALL");
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState("ALL");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(symbol, 350);

  const { data, loading, error } = useApi("/admin/orders", {
    query: {
      page,
      limit: 20,
      status: status === "ALL" ? undefined : status,
      symbol: debounced || undefined,
      side: side === "ALL" ? undefined : side,
    },
  });
  const orders = data?.orders ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          options={[
            { value: "ALL", label: "All" },
            { value: "PENDING", label: "Pending" },
            { value: "EXECUTED", label: "Executed" },
            { value: "REJECTED", label: "Rejected" },
          ]}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          size="sm"
          ariaLabel="Order status"
        />
        <Input
          value={symbol}
          onChange={(event) => {
            setSymbol(event.target.value.toUpperCase());
            setPage(1);
          }}
          placeholder="Symbol"
          inputSize="sm"
          className="w-[140px] font-mono uppercase"
        />
        <Select value={side} onValueChange={setSide}>
          <SelectTrigger className="h-8 w-[120px] text-[11.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Any side</SelectItem>
            <SelectItem value="BUY">Buy</SelectItem>
            <SelectItem value="SELL">Sell</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-[10.5px] text-fg-subtle">
          {pagination?.total ? `${pagination.total} orders` : "—"}
        </span>
      </div>

      <Card>
        <DataTable
          caption="Admin orders"
          loading={loading && !orders.length}
          rows={orders}
          empty={
            error ? (
              <ErrorState compact code={error.code} title="Could not load orders" description={error.message} />
            ) : (
              <EmptyState compact icon={ListOrdered} title="No orders found" description="Adjust the filters." />
            )
          }
          columns={[
            {
              key: "symbol",
              header: "Order",
              render: (row) => (
                <div className="flex items-center gap-2">
                  <Badge tone={row.side === "BUY" ? "up" : "down"}>{row.side}</Badge>
                  <div>
                    <p className="font-mono text-[11.5px] text-fg">{row.symbol}</p>
                    <p className="text-[9.5px] text-fg-subtle">{row.type.replace("_", " ")}</p>
                  </div>
                </div>
              ),
            },
            {
              key: "owner",
              header: "Owner",
              render: (row) => (
                <div>
                  <p className="text-[11px] text-fg">{row.owner?.name}</p>
                  <p className="text-[9.5px] text-fg-subtle">{row.owner?.email}</p>
                </div>
              ),
            },
            {
              key: "portfolio",
              header: "Portfolio",
              render: (row) => row.portfolio?.name,
            },
            {
              key: "quantity",
              header: "Qty",
              align: "right",
              render: (row) => formatQuantity(row.quantity),
            },
            {
              key: "price",
              header: "Price",
              align: "right",
              render: (row) =>
                row.executedPrice
                  ? formatPrice(row.executedPrice)
                  : row.limitPrice
                    ? formatPrice(row.limitPrice)
                    : row.stopPrice
                      ? formatPrice(row.stopPrice)
                      : "Market",
            },
            {
              key: "status",
              header: "Status",
              render: (row) => {
                const config = ORDER_STATUS[row.status] || ORDER_STATUS.PENDING;
                return <Badge tone={config.tone} dot>{config.label}</Badge>;
              },
            },
            {
              key: "createdAt",
              header: "Placed",
              align: "right",
              render: (row) => (
                <span className="text-[10.5px] text-fg-subtle">{formatRelative(row.createdAt)}</span>
              ),
            },
          ]}
          footer={
            <Pagination
              page={pagination?.page || page}
              totalPages={pagination?.totalPages || 1}
              total={pagination?.total}
              limit={pagination?.limit || 20}
              onPageChange={setPage}
            />
          }
        />
      </Card>
    </div>
  );
}

export default function AdminPage() {
  const user = useSession((state) => state.user);
  const router = useRouter();

  if (user?.role !== "ADMIN") {
    return (
      <ErrorState
        code="FORBIDDEN"
        title="Admin access required"
        description="This console is restricted to accounts with the ADMIN role."
        action={
          <Button variant="secondary" size="sm" onClick={() => router.push("/dashboard")}>
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to dashboard
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Admin console"
        description="Inspect users, portfolios and cross-user orders, and manage user account suspensions."
        actions={
          <Badge tone="violet" dot>
            <Shield className="size-3" aria-hidden="true" />
            ADMIN
          </Badge>
        }
      />

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">
            <Users className="size-3.5" aria-hidden="true" />
            Users
          </TabsTrigger>
          <TabsTrigger value="portfolios">
            <Wallet className="size-3.5" aria-hidden="true" />
            Portfolios
          </TabsTrigger>
          <TabsTrigger value="orders">
            <ListOrdered className="size-3.5" aria-hidden="true" />
            Orders
          </TabsTrigger>
        </TabsList>
        <TabsContent value="users"><AdminUsers /></TabsContent>
        <TabsContent value="portfolios"><AdminPortfolios /></TabsContent>
        <TabsContent value="orders"><AdminOrders /></TabsContent>
      </Tabs>
    </div>
  );
}
