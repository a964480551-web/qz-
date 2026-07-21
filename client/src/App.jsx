import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const DESIGNER_STORAGE_KEY = "model_platform_designer_account";
const DESIGNER_NAME_STORAGE_KEY = "model_platform_designer_name";
const ADMIN_TOKEN_KEY = "model_platform_admin_token";
const ADMIN_ACCOUNT_KEY = "model_platform_admin_account";
const ADMIN_LOGIN_CACHE_KEY = "model_platform_admin_login_cache";
const ADMIN_LAST_SEEN_KEY = "model_platform_admin_last_seen";
const DEFAULT_PAGE_SIZE = 20;

function StatusTag({ status }) {
  let cls = "";
  if (status === "待处理") cls = "tag-pending";
  else if (status === "制作中") cls = "tag-making";
  else if (status === "已完成") cls = "tag-done";
  else if (status === "已拒绝") cls = "tag-rejected";
  return <span className={`status-tag ${cls}`}>{status}</span>;
}

function QuotaBar({ used, total, remaining }) {
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  let cls = "quota-normal";
  if (remaining === 0) cls = "quota-empty";
  else if (remaining <= 5) cls = "quota-warn";
  return (
    <div className="quota-wrap">
      <div className="quota-text">
        已用 {used} / {total}，剩余 {remaining}（登记次数用完再找老师加，防止恶意登记）
      </div>
      <div className="quota-bar">
        <div className={`quota-fill ${cls}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function FullscreenImage({ src, onClose }) {
  if (!src) return null;
  return (
    <div className="fullscreen-mask" onClick={onClose}>
      <img className="fullscreen-image" src={src} alt="原图预览" />
    </div>
  );
}

function AuthenticatedImage({ src, token, alt, className, onOpen }) {
  const [displaySrc, setDisplaySrc] = useState("");

  useEffect(() => {
    if (!src) {
      setDisplaySrc("");
      return undefined;
    }
    if (src.startsWith("blob:") || src.startsWith("data:")) {
      setDisplaySrc(src);
      return undefined;
    }

    const controller = new AbortController();
    let objectUrl = "";
    fetch(src, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    })
      .then((response) => {
        if (!response.ok) throw new Error(`图片加载失败：${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setDisplaySrc(objectUrl);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setDisplaySrc("");
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, token]);

  if (!displaySrc) return <span className={className} aria-label={`${alt}加载中`} />;
  return (
    <img
      className={className}
      src={displaySrc}
      alt={alt}
      onClick={() => onOpen?.(displaySrc)}
    />
  );
}

function RejectModal({ open, value, onChange, onCancel, onConfirm, loading }) {
  if (!open) return null;
  return (
    <div className="fullscreen-mask" onClick={onCancel}>
      <div className="reject-modal" onClick={(e) => e.stopPropagation()}>
        <h3>填写拒绝理由</h3>
        <textarea
          rows={5}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="请输入拒绝理由"
        />
        <div className="actions">
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" onClick={onConfirm} disabled={loading}>
            {loading ? "处理中…" : "完成"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CommentsPanel({
  material,
  comments,
  loading,
  draft,
  onDraftChange,
  onSend,
  onRefresh
}) {
  return (
    <div className="comments-box">
      <div className="comments-head">
        <strong>留言区</strong>
        <button type="button" onClick={onRefresh}>
          刷新
        </button>
      </div>
      {loading ? <div className="muted">加载中…</div> : null}
      <div className="comments-list">
        {comments.length === 0 ? <div className="muted">暂无留言</div> : null}
        {comments.map((item) => (
          <div key={item.id} className="comment-item">
            <div className="comment-meta">
              <span>{`${item.author_role === "admin" ? "管理员" : "设计师"}：${item.author}`}</span>
              <span>{new Date(item.created_at).toLocaleString()}</span>
            </div>
            <div>{item.content}</div>
          </div>
        ))}
      </div>
      <div className="comments-input-row">
        <input
          value={draft}
          onChange={(e) => onDraftChange(material.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSend(material.id);
          }}
          placeholder="输入留言，按 Enter 发送"
        />
        <button type="button" onClick={() => onSend(material.id)}>
          发送
        </button>
      </div>
    </div>
  );
}

function Pager({ pageInfo, loading, onFirst, onPrev, onNext, onJump }) {
  const [jumpPage, setJumpPage] = useState("");
  const totalPages = Math.max(1, Number(pageInfo.totalPages) || 1);
  const currentPage = Math.min(totalPages, Math.max(1, Number(pageInfo.page) || 1));

  function submitJump() {
    const nextPage = Math.floor(Number(jumpPage));
    if (!Number.isFinite(nextPage)) return;
    const safePage = Math.min(totalPages, Math.max(1, nextPage));
    if (safePage === currentPage) {
      setJumpPage("");
      return;
    }
    onJump(safePage);
    setJumpPage("");
  }

  return (
    <div className="pagination">
      <button type="button" onClick={onFirst} disabled={loading || currentPage <= 1}>
        首页
      </button>
      <button type="button" onClick={onPrev} disabled={loading || pageInfo.page <= 1}>
        上一页
      </button>
      <span>
        第 {currentPage} / {totalPages} 页
      </span>
      <span>共 {pageInfo.total} 条</span>
      <div className="page-jump">
        <input
          type="number"
          min="1"
          max={totalPages}
          value={jumpPage}
          onChange={(e) => setJumpPage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitJump();
          }}
          placeholder="页数"
          disabled={loading}
        />
        <button type="button" onClick={submitJump} disabled={loading || !jumpPage.trim()}>
          跳转
        </button>
      </div>
      <button type="button" onClick={onNext} disabled={loading || pageInfo.page >= pageInfo.totalPages}>
        下一页
      </button>
    </div>
  );
}

function CollapsibleTextBox({ id, field, content, expanded, onToggle }) {
  const textRef = useRef(null);
  const text = content || "-";
  const hasMoreHint = text.length > 6;

  return (
    <div
      ref={textRef}
      className={`collapsible-text-box ${expanded ? "expanded" : ""} ${hasMoreHint ? "has-more" : ""}`}
      title={expanded ? "点击收起" : "点击展开"}
      onClick={() => onToggle(id, field)}
    >
      {text}
    </div>
  );
}

function DesignerView() {
  const [account, setAccount] = useState(localStorage.getItem(DESIGNER_STORAGE_KEY) || "");
  const [ownerName, setOwnerName] = useState(localStorage.getItem(DESIGNER_NAME_STORAGE_KEY) || "");
  const [accountValid, setAccountValid] = useState(false);
  const [quota, setQuota] = useState({ usedCount: 0, totalQuota: 30, remaining: 30 });
  const [materials, setMaterials] = useState([]);
  const [boardMaterials, setBoardMaterials] = useState([]);
  const [form, setForm] = useState({
    materialId: "",
    requirement: "",
    file: null
  });
  const [previewUrl, setPreviewUrl] = useState("");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [viewerSrc, setViewerSrc] = useState("");

  const [openedComments, setOpenedComments] = useState({});
  const [commentsMap, setCommentsMap] = useState({});
  const [commentsLoading, setCommentsLoading] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [accountChecking, setAccountChecking] = useState(false);
  const [recordTab, setRecordTab] = useState("mine");

  const accountReady = account.trim().length > 0 && ownerName.trim().length > 0;

  async function api(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const method = options.method || "GET";
      throw new Error(data.message || `请求失败：${method} ${path} 返回 ${res.status}`);
    }
    return data;
  }

  async function checkAccountAndLoad(nextAccount) {
    const input = nextAccount.trim();
    if (!input) {
      setAccountValid(false);
      setMaterials([]);
      return;
    }
    setAccountChecking(true);
    try {
      const data = await api("/api/check-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: input, ownerName: ownerName.trim() })
      });
      if (!data.exists) {
        setAccountValid(false);
        setMaterials([]);
        setMessage("账号不存在，请联系管理员添加。");
        return;
      }
      setAccountValid(true);
      localStorage.setItem(DESIGNER_STORAGE_KEY, input);
      localStorage.setItem(DESIGNER_NAME_STORAGE_KEY, ownerName.trim());
      const [quotaRes, materialsRes] = await Promise.all([
        api(`/api/quota?account=${encodeURIComponent(input)}&ownerName=${encodeURIComponent(ownerName.trim())}`),
        api(`/api/materials?account=${encodeURIComponent(input)}&ownerName=${encodeURIComponent(ownerName.trim())}`)
      ]);
      setQuota(quotaRes);
      setMaterials(materialsRes);
      try {
        const boardRes = await api(
          `/api/materials/board?account=${encodeURIComponent(input)}&ownerName=${encodeURIComponent(ownerName.trim())}`
        );
        setBoardMaterials(boardRes);
      } catch (_e) {
        setBoardMaterials([]);
      }
      setMessage("");
    } catch (error) {
      setAccountValid(false);
      setMaterials([]);
      setMessage(error.message);
    } finally {
      setAccountChecking(false);
    }
  }

  useEffect(() => {
    if (accountReady) {
      checkAccountAndLoad(account);
    }
  }, []);

  async function handleAccountBlur() {
    await checkAccountAndLoad(account);
  }

  function validateFile(file) {
    if (!file) {
      return "请上传 1 张图片";
    }
    const okTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!okTypes.includes(file.type)) {
      return "图片格式仅支持 jpg/png/webp";
    }
    if (file.size > 5 * 1024 * 1024) {
      return "请压缩到 5 MB 内，支持 jpg/png/webp";
    }
    return "";
  }

  function setSelectedFile(file) {
    const err = validateFile(file);
    if (err) {
      setMessage(err);
      setFieldErrors((prev) => ({ ...prev, image: err }));
      return;
    }
    setForm((prev) => ({ ...prev, file }));
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setMessage("");
    setFieldErrors((prev) => ({ ...prev, image: "" }));
  }

  async function handlePaste(event) {
    const items = event.clipboardData?.items || [];
    const imageItem = Array.from(items).find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    setSelectedFile(file);
  }

  async function submitMaterial(isUrgent = false) {
    if (!accountValid) {
      setMessage("请先输入有效账号");
      return;
    }
    const fileError = validateFile(form.file);
    if (fileError) {
      setMessage(fileError);
      return;
    }
    if (!form.materialId.trim() || !form.requirement.trim()) {
      setMessage("素材 ID 和需求不能为空");
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("account", account.trim());
      formData.append("materialId", form.materialId.trim());
      formData.append("name", form.requirement.trim());
      formData.append("requirement", form.requirement.trim());
      formData.append("isUrgent", isUrgent ? "true" : "false");
      formData.append("image", form.file);
      await api("/api/materials", {
        method: "POST",
        body: formData
      });
      await checkAccountAndLoad(account);
      try {
        const boardRes = await api(`/api/materials/board?account=${encodeURIComponent(account.trim())}`);
        setBoardMaterials(boardRes);
      } catch (_e) {
        // ignore board refresh failure
      }
      setForm({ materialId: "", requirement: "", file: null });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl("");
      setMessage(isUrgent ? "加急登记成功" : "提交成功");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await submitMaterialSecure(false);
  }

  async function submitMaterialSecure(isUrgent = false) {
    const nextErrors = {
      materialId: form.materialId.trim() ? "" : "请填写素材 ID",
      requirement: form.requirement.trim() ? "" : "请填写需求",
      image: form.file ? "" : "请添加一张图片"
    };
    setFieldErrors(nextErrors);
    if (nextErrors.materialId || nextErrors.requirement || nextErrors.image) {
      setMessage("请补全必填项");
      return;
    }
    if (!accountValid) {
      setMessage("请先输入有效账号");
      return;
    }
    if (!ownerName.trim()) {
      setMessage("请先输入对应姓名");
      return;
    }
    const fileError = validateFile(form.file);
    if (fileError) {
      setMessage(fileError);
      return;
    }
    if (!form.materialId.trim() || !form.requirement.trim()) {
      setMessage("素材 ID 和需求不能为空");
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("account", account.trim());
      formData.append("ownerName", ownerName.trim());
      formData.append("materialId", form.materialId.trim());
      formData.append("name", form.requirement.trim());
      formData.append("requirement", form.requirement.trim());
      formData.append("isUrgent", isUrgent ? "true" : "false");
      formData.append("image", form.file);
      await api("/api/materials", {
        method: "POST",
        body: formData
      });
      await checkAccountAndLoad(account);
      try {
        const boardRes = await api(
          `/api/materials/board?account=${encodeURIComponent(account.trim())}&ownerName=${encodeURIComponent(ownerName.trim())}`
        );
        setBoardMaterials(boardRes);
      } catch (_e) {
        // ignore board refresh failure
      }
      setForm({ materialId: "", requirement: "", file: null });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl("");
      setMessage(isUrgent ? "加急登记成功" : "提交成功");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadComments(materialId) {
    setCommentsLoading((prev) => ({ ...prev, [materialId]: true }));
    try {
      const rows = await api(
        `/api/materials/${materialId}/comments?account=${encodeURIComponent(account.trim())}&ownerName=${encodeURIComponent(ownerName.trim())}`
      );
      setCommentsMap((prev) => ({ ...prev, [materialId]: rows }));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setCommentsLoading((prev) => ({ ...prev, [materialId]: false }));
    }
  }

  async function toggleComments(materialId) {
    const open = !openedComments[materialId];
    setOpenedComments((prev) => ({ ...prev, [materialId]: open }));
    if (open) {
      await loadComments(materialId);
    }
  }

  function onDraftChange(materialId, text) {
    setCommentDrafts((prev) => ({ ...prev, [materialId]: text }));
  }

  function openHelperSite(url) {
    const tipText = "提示：新窗口已打开，如果没打开，就粘贴到新网页打开，已复制";
    const newWin = window.open(url, "_blank", "noopener,noreferrer");
    const writePromise = navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(url)
      : Promise.resolve();

    writePromise.catch(() => {}).finally(() => {
      window.alert(tipText);
    });

    return newWin;
  }

  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement("textarea");
        input.value = text;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setMessage("素材库编码已复制");
    } catch (_error) {
      setMessage("复制失败，请手动选中素材库编码复制");
    }
  }

  async function sendComment(materialId) {
    const content = (commentDrafts[materialId] || "").trim();
    if (!content) return;
    try {
      await api(`/api/materials/${materialId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: account.trim(), ownerName: ownerName.trim(), content })
      });
      setCommentDrafts((prev) => ({ ...prev, [materialId]: "" }));
      await loadComments(materialId);
    } catch (error) {
      setMessage(error.message);
    }
  }

  const tableRows = useMemo(() => materials, [materials]);

  return (
    <div className="panel">
      <div className="card ui-card">
        <h2>设计师账号校验</h2>
        <div className="account-check-block">
          <label className="account-check-label">志邦账号</label>
          <div className="account-check-row">
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              onBlur={handleAccountBlur}
              placeholder="请输入账号"
            />
            <button type="button" onClick={handleAccountBlur} disabled={accountChecking}>
              {accountChecking ? "校验中…" : "校验账号"}
            </button>
          </div>
          <label className="account-check-label">对应姓名（姓名不行就和账号相同或自己改过名）</label>
          <div className="account-check-row">
            <input
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              onBlur={handleAccountBlur}
              placeholder="请输入姓名"
            />
            <span />
          </div>
        </div>
        {accountValid ? (
          <QuotaBar
            used={quota.usedCount}
            total={quota.totalQuota}
            remaining={quota.remaining}
          />
        ) : null}
        {message ? <div className="message">{message}</div> : null}
      </div>

      <form className="card ui-card" onSubmit={handleSubmit}>
        <h3>模型登记</h3>
        <div className="helper-sites-panel">
          <div className="helper-sites-title">找模型 / 找贴图</div>
          <div className="helper-site-buttons">
            <button
              type="button"
              className="helper-site-btn model-btn"
              onClick={() => {
                openHelperSite("https://3d.znzmo.com/");
              }}
            >
              找模型
            </button>
            <button
              type="button"
              className="helper-site-btn texture-btn"
              onClick={() => {
                openHelperSite("https://tietu.znzmo.com/tietunewhome.html");
              }}
            >
              找贴图
            </button>
          </div>
        </div>
        <div>
          <div>
            <label>素材 ID（网站上的 ID）</label>
            <input
              value={form.materialId}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, materialId: e.target.value }));
                setFieldErrors((prev) => ({ ...prev, materialId: "" }));
              }}
            />
            {fieldErrors.materialId ? <div className="field-error">{fieldErrors.materialId}</div> : null}
          </div>
        </div>
        <div>
          <label>需要传的模型截图（支持粘贴 Ctrl+V 截图）</label>
          <div
            className="paste-image-box"
            tabIndex={0}
            onPaste={handlePaste}
            onClick={(e) => e.currentTarget.focus()}
          >
            <div className="paste-image-title">粘贴截图区域</div>
            <div className="paste-image-hint">点这里后按 Ctrl+V，把截图粘贴到框内</div>
            {previewUrl ? (
              <img className="paste-image-preview" src={previewUrl} alt="截图预览" />
            ) : null}
          </div>
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setSelectedFile(file);
            }}
          />
          {fieldErrors.image ? <div className="field-error">{fieldErrors.image}</div> : null}
          {previewUrl ? (
            <div className="preview-wrap">
              <button
                type="button"
                onClick={() => {
                  if (previewUrl) URL.revokeObjectURL(previewUrl);
                  setPreviewUrl("");
                  setForm((prev) => ({ ...prev, file: null }));
                }}
              >
                删除图片
              </button>
            </div>
          ) : null}
        </div>
        <div>
          <label>需求（不要写全都要，麻烦在截图的时候圈一下，或说明具体做什么，感谢）</label>
          <textarea
            rows={4}
            value={form.requirement}
            onChange={(e) => {
              setForm((prev) => ({ ...prev, requirement: e.target.value }));
              setFieldErrors((prev) => ({ ...prev, requirement: "" }));
            }}
          />
          {fieldErrors.requirement ? <div className="field-error">{fieldErrors.requirement}</div> : null}
        </div>
        <div className="submit-actions">
          <button type="submit" disabled={loading || !accountValid}>
            {loading ? "提交中…" : "提交登记"}
          </button>
            <button
              type="button"
              className="urgent-btn"
              disabled={loading || !accountValid}
              onClick={() => submitMaterialSecure(true)}
            >
            {loading ? "提交中…" : "加急登记"}
          </button>
        </div>
        <div className="urgent-note">提醒（请至少提前一天登记，第一用可以加急，加急会扣除 5 次登记）</div>
      </form>

      <div className="card record-card">
        <h3>我的记录</h3>
        <div className="tabs record-tabs">
          <button
            type="button"
            className={recordTab === "mine" ? "active" : ""}
            onClick={() => setRecordTab("mine")}
          >
            我的记录
          </button>
          <button
            type="button"
            className={recordTab === "others" ? "active" : ""}
            onClick={() => setRecordTab("others")}
          >
            排队情况
          </button>
        </div>
        {recordTab === "mine" ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>素材 ID</th>
                <th>加急</th>
                <th>需求</th>
                <th>图片</th>
                <th className="status-cell">状态</th>
                <th>素材库编码</th>
                <th>备注</th>
                <th>拒绝理由</th>
                <th>留言</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">暂无记录</td>
                </tr>
              ) : null}
              {tableRows.map((item) => {
                const imageSrc =
                  `${API_BASE}${item.imagePath}?account=${encodeURIComponent(account.trim())}` +
                  `&ownerName=${encodeURIComponent(ownerName.trim())}`;
                return (
                  <>
                    <tr key={item.id}>
                      <td>{item.materialId}</td>
                      <td>{item.isUrgent ? <span className="urgent-admin-tag">加急登记</span> : "-"}</td>
                      <td>{item.requirement || "-"}</td>
                      <td>
                        <img
                          className="thumb"
                          src={imageSrc}
                          alt={item.requirement || item.materialId}
                          onClick={() => setViewerSrc(imageSrc)}
                        />
                      </td>
                      <td className="status-cell"><StatusTag status={item.status} /></td>
                      <td>
                        <span>{item.materialCode || "-"}</span>
                        {item.materialCode ? (
                          <button
                            type="button"
                            className="inline-btn"
                            onClick={() => copyTextToClipboard(item.materialCode)}
                          >
                            复制
                          </button>
                        ) : null}
                      </td>
                      <td>
                        <div>{item.techNotes || "-"}</div>
                        {item.techNoteImagePath ? (
                          <img
                            className="note-thumb"
                            src={`${API_BASE}${item.techNoteImagePath}?account=${encodeURIComponent(account.trim())}&ownerName=${encodeURIComponent(ownerName.trim())}`}
                            alt="备注图片"
                            onClick={() =>
                              setViewerSrc(
                                `${API_BASE}${item.techNoteImagePath}?account=${encodeURIComponent(account.trim())}&ownerName=${encodeURIComponent(ownerName.trim())}`
                              )
                            }
                          />
                        ) : null}
                      </td>
                      <td>{item.rejectReason || "-"}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => toggleComments(item.id)}
                        >
                          {openedComments[item.id] ? "收起" : "留言"}
                        </button>
                      </td>
                    </tr>
                    {openedComments[item.id] ? (
                      <tr key={`${item.id}-comments`}>
                          <td colSpan={9}>
                          <CommentsPanel
                            material={item}
                            comments={commentsMap[item.id] || []}
                            loading={!!commentsLoading[item.id]}
                            draft={commentDrafts[item.id] || ""}
                            onDraftChange={onDraftChange}
                            onSend={sendComment}
                            onRefresh={() => loadComments(item.id)}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>素材 ID</th>
                <th>状态</th>
                <th>需求</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {boardMaterials.filter((item) => item.status !== "已完成" && item.status !== "已拒绝").length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">暂无排队任务</td>
                </tr>
              ) : null}
              {boardMaterials
                .filter((item) => item.status !== "已完成" && item.status !== "已拒绝")
                .map((item) => (
                <tr key={`board-${item.id}`}>
                  <td>{item.materialId}</td>
                  <td><StatusTag status={item.status} /></td>
                  <td>{item.requirement || "-"}</td>
                  <td>{item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>
      <FullscreenImage src={viewerSrc} onClose={() => setViewerSrc("")} />
    </div>
  );
}

function AdminView() {
  const [token, setToken] = useState(localStorage.getItem(ADMIN_TOKEN_KEY) || "");
  const [adminAccount, setAdminAccount] = useState(localStorage.getItem(ADMIN_ACCOUNT_KEY) || "");
  const loginCache = (() => {
    try {
      const raw = localStorage.getItem(ADMIN_LOGIN_CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  })();
  const [rememberLogin, setRememberLogin] = useState(Boolean(loginCache?.remember));
  const [loginForm, setLoginForm] = useState({
    account: loginCache?.account || adminAccount || "",
    password: ""
  });
  const [materials, setMaterials] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [staffs, setStaffs] = useState([]);
  const [message, setMessage] = useState("");
  const [viewerSrc, setViewerSrc] = useState("");
  const [editingId, setEditingId] = useState(0);
  const [editForm, setEditForm] = useState({
    materialCode: "",
    techNotes: "",
    techNoteImageFile: null,
    techNoteImagePreview: "",
    existingTechNoteImagePath: "",
    removeTechNoteImage: false
  });
  const [designerSingleForm, setDesignerSingleForm] = useState({ account: "", ownerName: "" });
  const [designerBulk, setDesignerBulk] = useState("");
  const [staffSingleForm, setStaffSingleForm] = useState({ account: "", password: "" });
  const [announcementForm, setAnnouncementForm] = useState({ title: "", content: "", enabled: false });
  const [loading, setLoading] = useState(false);

  const [openedComments, setOpenedComments] = useState({});
  const [commentsMap, setCommentsMap] = useState({});
  const [commentsLoading, setCommentsLoading] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [expandedTextBoxes, setExpandedTextBoxes] = useState({});
  const [lastSeenMap, setLastSeenMap] = useState(() => {
    try {
      const raw = localStorage.getItem(ADMIN_LAST_SEEN_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_error) {
      return {};
    }
  });
  const [unreadMap, setUnreadMap] = useState({});
  const [selectedAccounts, setSelectedAccounts] = useState({});
  const [selectedStaffs, setSelectedStaffs] = useState({});
  const [quotaAddMap, setQuotaAddMap] = useState({});
  const [quotaSetMap, setQuotaSetMap] = useState({});
  const [staffPasswordMap, setStaffPasswordMap] = useState({});
  const [rejectDialog, setRejectDialog] = useState({ open: false, id: 0, reason: "", saving: false });
  const [adminTab, setAdminTab] = useState("materials");
  const [materialsSearchInput, setMaterialsSearchInput] = useState("");
  const [materialsSearch, setMaterialsSearch] = useState("");
  const [materialsPageInfo, setMaterialsPageInfo] = useState({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 1
  });
  const [accountsSearchInput, setAccountsSearchInput] = useState("");
  const [accountsSearch, setAccountsSearch] = useState("");
  const [accountsPageInfo, setAccountsPageInfo] = useState({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 1
  });

  const loggedIn = token.length > 0;

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const method = options.method || "GET";
      throw new Error(data.message || `请求失败：${method} ${path} 返回 ${res.status}`);
    }
    return data;
  }

  async function loadMaterialsPage(page = materialsPageInfo.page, search = materialsSearch) {
    if (!loggedIn) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(DEFAULT_PAGE_SIZE)
      });
      if (search.trim()) params.set("search", search.trim());
      const data = await api(`/api/materials?${params.toString()}`);
      const sourceItems = Array.isArray(data) ? data : data.items || [];
      const keyword = search.trim();
      const filteredItems = Array.isArray(data) && keyword
        ? sourceItems.filter((item) =>
            [item.account, item.materialId, item.requirement, item.status].some((value) =>
              String(value || "").includes(keyword)
            )
          )
        : sourceItems;
      const items = Array.isArray(data)
        ? filteredItems.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE)
        : filteredItems;
      setMaterials(items);
      setMaterialsPageInfo({
        page: Array.isArray(data) ? page : data.page || page,
        pageSize: Array.isArray(data) ? DEFAULT_PAGE_SIZE : data.pageSize || DEFAULT_PAGE_SIZE,
        total: Array.isArray(data) ? filteredItems.length : data.total || 0,
        totalPages: Array.isArray(data) ? Math.max(1, Math.ceil(filteredItems.length / DEFAULT_PAGE_SIZE)) : data.totalPages || 1
      });
      const nextUnread = {};
      for (const item of items) nextUnread[item.id] = item.unreadCount || 0;
      if (items.length > 0 && items.some((item) => typeof item.unreadCount !== "number")) {
        const checks = await Promise.all(
          items.map(async (item) => {
            try {
              const rows = await api(`/api/materials/${item.id}/comments`);
              const lastSeen = lastSeenMap[item.id] || "";
              const unread = rows.filter(
                (row) =>
                  row.author_role === "designer" &&
                  (!lastSeen || new Date(row.created_at).getTime() > new Date(lastSeen).getTime())
              ).length;
              return { id: item.id, unread };
            } catch (_error) {
              return { id: item.id, unread: 0 };
            }
          })
        );
        for (const item of checks) nextUnread[item.id] = item.unread;
      }
      setUnreadMap(nextUnread);
      setOpenedComments((prev) => {
        const ids = new Set(items.map((item) => item.id));
        return Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(Number(id))));
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadAccountsPage(page = accountsPageInfo.page, search = accountsSearch) {
    if (!loggedIn) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(DEFAULT_PAGE_SIZE)
      });
      if (search.trim()) params.set("search", search.trim());
      const data = await api(`/api/accounts?${params.toString()}`);
      const sourceItems = Array.isArray(data) ? data : data.items || [];
      const keyword = search.trim();
      const filteredItems = Array.isArray(data) && keyword
        ? sourceItems.filter((item) =>
            [item.account, item.owner_name].some((value) =>
              String(value || "").includes(keyword)
            )
          )
        : sourceItems;
      const items = Array.isArray(data)
        ? filteredItems.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE)
        : filteredItems;
      setAccounts(items);
      setAccountsPageInfo({
        page: Array.isArray(data) ? page : data.page || page,
        pageSize: Array.isArray(data) ? DEFAULT_PAGE_SIZE : data.pageSize || DEFAULT_PAGE_SIZE,
        total: Array.isArray(data) ? filteredItems.length : data.total || 0,
        totalPages: Array.isArray(data) ? Math.max(1, Math.ceil(filteredItems.length / DEFAULT_PAGE_SIZE)) : data.totalPages || 1
      });
      setSelectedAccounts((prev) => {
        const accountSet = new Set(items.map((item) => item.account));
        return Object.fromEntries(Object.entries(prev).filter(([account]) => accountSet.has(account)));
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadStaffs() {
    if (!loggedIn) return;
    try {
      const staffRes = await api("/api/staff");
      setStaffs(staffRes);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadAnnouncementConfig() {
    if (!loggedIn) return;
    try {
      const data = await api("/api/admin/announcement");
      setAnnouncementForm({
        title: data.title || "",
        content: data.content || "",
        enabled: !!data.enabled
      });
    } catch (error) {
      setMessage(error.message);
    }
  }

  useEffect(() => {
    if (!loggedIn) return;
    loadMaterialsPage(1, materialsSearch);
    loadStaffs();
    loadAnnouncementConfig();
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn) return;
    if (adminTab === "materials") loadMaterialsPage(materialsPageInfo.page, materialsSearch);
    if (adminTab === "designerAccounts") loadAccountsPage(accountsPageInfo.page, accountsSearch);
    if (adminTab === "staffAccounts") loadStaffs();
    if (adminTab === "announcement") loadAnnouncementConfig();
  }, [adminTab]);

  async function searchMaterials() {
    const nextSearch = materialsSearchInput.trim();
    setMaterialsSearch(nextSearch);
    await loadMaterialsPage(1, nextSearch);
  }

  async function searchAccounts() {
    const nextSearch = accountsSearchInput.trim();
    setAccountsSearch(nextSearch);
    await loadAccountsPage(1, nextSearch);
  }

  async function refreshMaterialsAfterDelete() {
    const nextPage = materials.length <= 1 && materialsPageInfo.page > 1
      ? materialsPageInfo.page - 1
      : materialsPageInfo.page;
    await loadMaterialsPage(nextPage, materialsSearch);
  }

  async function refreshAccountsAfterDelete(deletedCount = 1) {
    const nextPage = accounts.length <= deletedCount && accountsPageInfo.page > 1
      ? accountsPageInfo.page - 1
      : accountsPageInfo.page;
    await loadAccountsPage(nextPage, accountsSearch);
  }

  async function login() {
    try {
      const data = await fetch(`${API_BASE}/api/staff-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm)
      }).then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message || `登录失败：接口返回 ${res.status}`);
        return json;
      });
      setToken(data.token);
      setAdminAccount(data.account);
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      localStorage.setItem(ADMIN_ACCOUNT_KEY, data.account);
      if (rememberLogin) {
        localStorage.setItem(
          ADMIN_LOGIN_CACHE_KEY,
          JSON.stringify({
            remember: true,
            account: loginForm.account
          })
        );
      } else {
        localStorage.removeItem(ADMIN_LOGIN_CACHE_KEY);
      }
      setMessage("登录成功");
    } catch (error) {
      setMessage(error.message);
    }
  }

  function logout() {
    setToken("");
    setAdminAccount("");
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_ACCOUNT_KEY);
  }

  async function addSingleStaff() {
    const account = staffSingleForm.account.trim();
    const password = staffSingleForm.password.trim();
    if (!account || !password) {
      setMessage("请填写管理员账号和密码");
      return;
    }
    try {
      await api("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ account, password }] })
      });
      setStaffSingleForm({ account: "", password: "" });
      setMessage("管理员添加成功");
      await loadStaffs();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function saveAnnouncement() {
    try {
      await api("/api/admin/announcement", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(announcementForm)
      });
      setMessage("公告保存成功");
      await loadAnnouncementConfig();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function acceptItem(id) {
    try {
      await api(`/api/materials/${id}/accept`, { method: "PUT" });
      await loadMaterialsPage(materialsPageInfo.page, materialsSearch);
    } catch (error) {
      setMessage(error.message);
    }
  }

  function rejectItem(id) {
    setRejectDialog({ open: true, id, reason: "", saving: false });
  }

  async function confirmReject() {
    const reason = (rejectDialog.reason || "").trim();
    if (!reason) {
      setMessage("请填写拒绝理由");
      return;
    }
    setRejectDialog((prev) => ({ ...prev, saving: true }));
    try {
      await api(`/api/materials/${rejectDialog.id}/reject`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      });
      setRejectDialog({ open: false, id: 0, reason: "", saving: false });
      await loadMaterialsPage(materialsPageInfo.page, materialsSearch);
      setMessage("拒绝成功");
    } catch (error) {
      setRejectDialog((prev) => ({ ...prev, saving: false }));
      setMessage(error.message);
    }
  }

  function startEdit(item) {
    if (editForm.techNoteImagePreview) URL.revokeObjectURL(editForm.techNoteImagePreview);
    setEditingId(item.id);
    setEditForm({
      materialCode: item.materialCode || "",
      techNotes: item.techNotes || "",
      techNoteImageFile: null,
      techNoteImagePreview: "",
      existingTechNoteImagePath: item.techNoteImagePath || "",
      removeTechNoteImage: false
    });
  }

  async function saveEdit(item) {
    try {
      const formData = new FormData();
      formData.append("materialCode", editForm.materialCode);
      formData.append("techNotes", editForm.techNotes);
      formData.append("removeTechNoteImage", editForm.removeTechNoteImage ? "true" : "false");
      if (editForm.techNoteImageFile) {
        formData.append("techNoteImage", editForm.techNoteImageFile);
      }
      await api(`/api/materials/${item.id}`, {
        method: "PUT",
        body: formData
      });
      if (editForm.techNoteImagePreview) URL.revokeObjectURL(editForm.techNoteImagePreview);
      setEditingId(0);
      await loadMaterialsPage(materialsPageInfo.page, materialsSearch);
    } catch (error) {
      setMessage(error.message);
    }
  }

  function handleTechNotePaste(event) {
    const imageItem = Array.from(event.clipboardData?.items || []).find((item) =>
      item.type.startsWith("image/")
    );
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    const okTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!okTypes.includes(file.type)) {
      setMessage("图片格式仅支持 jpg/png/webp");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage("请压缩到 5 MB 内，支持 jpg/png/webp");
      return;
    }
    event.preventDefault();
    if (editForm.techNoteImagePreview) URL.revokeObjectURL(editForm.techNoteImagePreview);
    setEditForm((prev) => ({
      ...prev,
      techNoteImageFile: file,
      techNoteImagePreview: URL.createObjectURL(file),
      removeTechNoteImage: false
    }));
  }

  function removeTechNoteImage() {
    if (editForm.techNoteImagePreview) URL.revokeObjectURL(editForm.techNoteImagePreview);
    setEditForm((prev) => ({
      ...prev,
      techNoteImageFile: null,
      techNoteImagePreview: "",
      existingTechNoteImagePath: "",
      removeTechNoteImage: true
    }));
  }

  async function deleteItem(id) {
    const ok = window.confirm("确定删除该任务吗？删除后不返还额度。");
    if (!ok) return;
    try {
      await api(`/api/materials/${id}`, { method: "DELETE" });
      await refreshMaterialsAfterDelete();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function addSingleDesigner() {
    const account = designerSingleForm.account.trim();
    const ownerName = designerSingleForm.ownerName.trim();
    if (!account || !ownerName) {
      setMessage("请填写设计师账号和姓名");
      return;
    }
    try {
      await api("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ account, ownerName }] })
      });
      setDesignerSingleForm({ account: "", ownerName: "" });
      await loadAccountsPage(1, accountsSearch);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function addDesignerBulk() {
    const lines = designerBulk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const items = lines
      .map((line) => {
        const [account, ownerName] = line
          .split(/[,+，\s]+/)
          .map((v) => (v || "").trim())
          .filter(Boolean);
        return { account, ownerName };
      })
      .filter((v) => v.account && v.ownerName);
    if (items.length === 0) {
      setMessage("请按格式填写：账号+姓名、账号 姓名，或从表格复制两列后每行一条");
      return;
    }
    try {
      const data = await api("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items })
      });
      setDesignerBulk("");
      setMessage(`批量添加完成：新增 ${data.added || 0} 个，跳过 ${data.skipped || 0} 个，失败 ${data.failed?.length || 0} 个`);
      setAccountsSearchInput("");
      setAccountsSearch("");
      await loadAccountsPage(1, "");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function removeAccount(account) {
    if (!window.confirm(`确认删除账号 ${account} 吗？`)) return;
    try {
      await api(`/api/accounts/${encodeURIComponent(account)}`, { method: "DELETE" });
      await refreshAccountsAfterDelete();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function addAccountQuota(account) {
    const amount = Number(quotaAddMap[account] || 1);
    if (!Number.isFinite(amount) || amount < 1) {
      setMessage("请输入大于 0 的额度数值");
      return;
    }
    try {
      await api(`/api/accounts/${encodeURIComponent(account)}/quota/add`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount })
      });
      setMessage(`已为 ${account} 增加 ${amount} 次额度`);
      setQuotaAddMap((prev) => ({ ...prev, [account]: "" }));
      await loadAccountsPage(accountsPageInfo.page, accountsSearch);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function setAccountQuota(account) {
    const totalQuota = Number(quotaSetMap[account]);
    if (!Number.isFinite(totalQuota) || totalQuota < 0) {
      setMessage("请输入有效的初始额度");
      return;
    }
    try {
      await api(`/api/accounts/${encodeURIComponent(account)}/quota/set`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalQuota })
      });
      setMessage(`已把 ${account} 的初始额度设置为 ${totalQuota}`);
      setQuotaSetMap((prev) => ({ ...prev, [account]: "" }));
      await loadAccountsPage(accountsPageInfo.page, accountsSearch);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function resetAccountQuota(account) {
    if (!window.confirm(`确认重置 ${account} 的已用额度吗？`)) return;
    try {
      await api(`/api/accounts/${encodeURIComponent(account)}/quota/reset`, { method: "PUT" });
      setMessage(`已重置 ${account} 的额度`);
      await loadAccountsPage(accountsPageInfo.page, accountsSearch);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function removeAccountsBatch() {
    const list = Object.keys(selectedAccounts).filter((k) => selectedAccounts[k]);
    if (list.length === 0) {
      setMessage("请先勾选要删除的设计师账号");
      return;
    }
    if (!window.confirm(`确认批量删除 ${list.length} 个设计师账号吗？`)) return;
    try {
      await Promise.all(
        list.map((account) => api(`/api/accounts/${encodeURIComponent(account)}`, { method: "DELETE" }))
      );
      setSelectedAccounts({});
      await refreshAccountsAfterDelete(list.length);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function resetAllAccountQuota() {
    if (!window.confirm("确认重置所有设计师额度吗？所有人的已用次数会变为 0。")) return;
    try {
      const data = await api("/api/accounts/quota/reset-all", { method: "PUT" });
      setMessage(`已重置所有设计师额度，共 ${data.changed || 0} 个账号`);
      await loadAccountsPage(accountsPageInfo.page, accountsSearch);
    } catch (error) {
      setMessage(error.message);
    }
  }

  function toggleSelectAllAccounts() {
    const allSelected = accounts.length > 0 && accounts.every((item) => selectedAccounts[item.account]);
    const next = {};
    if (!allSelected) {
      for (const item of accounts) next[item.account] = true;
    }
    setSelectedAccounts(next);
  }

  async function removeStaff(account) {
    if (!window.confirm(`确认删除管理员 ${account} 吗？`)) return;
    try {
      await api(`/api/staff/${encodeURIComponent(account)}`, { method: "DELETE" });
      await loadStaffs();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function updateStaffPassword(account) {
    const password = (staffPasswordMap[account] || "").trim();
    if (!password) {
      setMessage("请填写新密码");
      return;
    }
    try {
      await api(`/api/staff/${encodeURIComponent(account)}/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      setStaffPasswordMap((prev) => ({ ...prev, [account]: "" }));
      setMessage(`已修改管理员 ${account} 的密码`);
      await loadStaffs();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function removeStaffsBatch() {
    const list = Object.keys(selectedStaffs).filter((k) => selectedStaffs[k]);
    if (list.length === 0) {
      setMessage("请先勾选要删除的管理员账号");
      return;
    }
    if (!window.confirm(`确认批量删除 ${list.length} 个管理员账号吗？`)) return;
    try {
      await Promise.all(
        list.map((account) => api(`/api/staff/${encodeURIComponent(account)}`, { method: "DELETE" }))
      );
      setSelectedStaffs({});
      await loadStaffs();
    } catch (error) {
      setMessage(error.message);
    }
  }

  function toggleSelectAllStaffs() {
    const allSelected = staffs.length > 0 && staffs.every((item) => selectedStaffs[item.account]);
    const next = {};
    if (!allSelected) {
      for (const item of staffs) next[item.account] = true;
    }
    setSelectedStaffs(next);
  }

  async function loadComments(materialId) {
    setCommentsLoading((prev) => ({ ...prev, [materialId]: true }));
    try {
      const rows = await api(`/api/materials/${materialId}/comments`);
      setCommentsMap((prev) => ({ ...prev, [materialId]: rows }));
      const latest = rows.length > 0 ? rows[rows.length - 1].created_at : "";
      setLastSeenMap((prev) => {
        const next = { ...prev, [materialId]: latest };
        localStorage.setItem(ADMIN_LAST_SEEN_KEY, JSON.stringify(next));
        return next;
      });
      setUnreadMap((prev) => ({ ...prev, [materialId]: 0 }));
      setMaterials((prev) =>
        prev.map((item) => (item.id === materialId ? { ...item, unreadCount: 0 } : item))
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setCommentsLoading((prev) => ({ ...prev, [materialId]: false }));
    }
  }

  async function toggleComments(materialId) {
    const open = !openedComments[materialId];
    setOpenedComments((prev) => ({ ...prev, [materialId]: open }));
    if (open) {
      await loadComments(materialId);
    }
  }

  function onDraftChange(materialId, text) {
    setCommentDrafts((prev) => ({ ...prev, [materialId]: text }));
  }

  function toggleTextBox(id, field) {
    const key = `${id}:${field}`;
    setExpandedTextBoxes((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function sendComment(materialId) {
    const content = (commentDrafts[materialId] || "").trim();
    if (!content) return;
    try {
      await api(`/api/materials/${materialId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      setCommentDrafts((prev) => ({ ...prev, [materialId]: "" }));
      await loadComments(materialId);
    } catch (error) {
      setMessage(error.message);
    }
  }

  useEffect(() => {
    if (!loggedIn) return;
    try {
      localStorage.setItem(ADMIN_LAST_SEEN_KEY, JSON.stringify(lastSeenMap));
    } catch (_error) {
      // ignore storage failure
    }
  }, [lastSeenMap, loggedIn]);

  if (!loggedIn) {
    return (
      <div className="panel">
        <div className="card ui-card">
          <h2>后台管理登录</h2>
          <div className="row">
            <label>账号</label>
            <input
              value={loginForm.account}
              onChange={(e) => setLoginForm((prev) => ({ ...prev, account: e.target.value }))}
            />
          </div>
          <div className="row">
            <label>密码</label>
            <input
              type="password"
              value={loginForm.password}
              onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
            />
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={rememberLogin}
              onChange={(e) => setRememberLogin(e.target.checked)}
            />
            <span>记住账号</span>
          </label>
          <button type="button" onClick={login}>
            登录
          </button>
          {message ? <div className="message">{message}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="card ui-card">
        <div className="between">
          <h2>后台管理</h2>
          <div>
            <span className="muted">当前管理员：{adminAccount}</span>
            <button className="inline-btn" type="button" onClick={logout}>
              退出登录            </button>
          </div>
        </div>
        {message ? <div className="message">{message}</div> : null}
      </div>

      <div className="tabs">
        <button
          type="button"
          className={adminTab === "materials" ? "active" : ""}
          onClick={() => setAdminTab("materials")}
        >
          模型管理列表
        </button>
        <button
          type="button"
          className={adminTab === "designerAccounts" ? "active" : ""}
          onClick={() => setAdminTab("designerAccounts")}
        >
          设计师账号管理
        </button>
        <button
          type="button"
          className={adminTab === "staffAccounts" ? "active" : ""}
          onClick={() => setAdminTab("staffAccounts")}
        >
          管理员账号管理
        </button>
        <button
          type="button"
          className={adminTab === "announcement" ? "active" : ""}
          onClick={() => setAdminTab("announcement")}
        >
          公告管理
        </button>
      </div>

      {adminTab === "materials" ? (
      <div className="card ui-card">
        <h3>模型管理列表</h3>
        <div className="list-toolbar">
          <input
            value={materialsSearchInput}
            onChange={(e) => setMaterialsSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") searchMaterials();
            }}
            placeholder="搜索设计师账号、素材 ID、需求、状态"
          />
          <button type="button" onClick={searchMaterials} disabled={loading}>搜索</button>
          <button
            type="button"
            onClick={() => {
              setMaterialsSearchInput("");
              setMaterialsSearch("");
              loadMaterialsPage(1, "");
            }}
            disabled={loading}
          >
            清空
          </button>
          <button
            type="button"
            onClick={() => loadMaterialsPage(materialsPageInfo.page, materialsSearch)}
            disabled={loading}
          >
            刷新
          </button>
        </div>
        <div className="table-wrap">
          <table className="admin-materials-table">
            <colgroup>
              <col className="admin-col-account" />
              <col className="admin-col-material-id" />
              <col className="admin-col-requirement" />
              <col className="admin-col-urgent" />
              <col className="admin-col-image" />
              <col className="admin-col-status" />
              <col className="admin-col-code" />
              <col className="admin-col-notes" />
              <col className="admin-col-producer" />
              <col className="admin-col-reject" />
              <col className="admin-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>设计师</th>
                <th>素材 ID</th>
                <th>需求</th>
                <th>加急</th>
                <th>图片</th>
                <th>状态</th>
                <th>编码</th>
                <th>备注</th>
                <th>制作人</th>
                <th>拒绝理由</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {materials.length === 0 ? (
                <tr>
                  <td colSpan={11} className="muted">暂无数据</td>
                </tr>
              ) : null}
              {materials.map((item) => {
                const editing = editingId === item.id;
                const imageSrc = `${API_BASE}${item.imagePath}`;
                return (
                  <>
                    <tr key={item.id}>
                      <td>{item.account}</td>
                      <td>{item.materialId}</td>
                      <td>
                        <CollapsibleTextBox
                          id={item.id}
                          field="requirement"
                          content={item.requirement}
                          expanded={!!expandedTextBoxes[`${item.id}:requirement`]}
                          onToggle={toggleTextBox}
                        />
                      </td>
                      <td>{item.isUrgent ? <span className="urgent-admin-tag">加急登记</span> : "-"}</td>
                      <td>
                        <AuthenticatedImage
                          className="thumb"
                          src={imageSrc}
                          token={token}
                          alt={item.requirement || item.materialId}
                          onOpen={setViewerSrc}
                        />
                      </td>
                      <td><StatusTag status={item.status} /></td>
                      <td>
                        {editing ? (
                          <input
                            value={editForm.materialCode}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, materialCode: e.target.value }))}
                          />
                        ) : (
                          <>
                            <span>{item.materialCode || "-"}</span>
                            {item.materialCode ? (
                              <button
                                type="button"
                                className="inline-btn"
                                onClick={() => navigator.clipboard.writeText(item.materialCode)}
                              >
                                复制
                              </button>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <div className="tech-note-edit-box">
                            <input
                              value={editForm.techNotes}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, techNotes: e.target.value }))}
                              onPaste={handleTechNotePaste}
                              placeholder="输入备注，或 Ctrl+V 粘贴图片"
                            />
                            {(editForm.techNoteImagePreview || editForm.existingTechNoteImagePath) ? (
                              <div className="note-preview-row">
                                <AuthenticatedImage
                                  className="note-thumb"
                                  src={
                                    editForm.techNoteImagePreview ||
                                    `${API_BASE}${editForm.existingTechNoteImagePath}`
                                  }
                                  token={token}
                                  alt="备注图片预览"
                                  onOpen={setViewerSrc}
                                />
                                <button className="note-delete-btn" type="button" onClick={removeTechNoteImage}>删除</button>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <>
                            <CollapsibleTextBox
                              id={item.id}
                              field="notes"
                              content={item.techNotes}
                              expanded={!!expandedTextBoxes[`${item.id}:notes`]}
                              onToggle={toggleTextBox}
                            />
                            {item.techNoteImagePath ? (
                              <AuthenticatedImage
                                className="note-thumb"
                                src={`${API_BASE}${item.techNoteImagePath}`}
                                token={token}
                                alt="备注图片"
                                onOpen={setViewerSrc}
                              />
                            ) : null}
                          </>
                      )}
                    </td>
                    <td>{item.producer || "-"}</td>
                      <td>{item.rejectReason || "-"}</td>
                      <td>
                        <div className="actions">
                          {(item.status === "待处理" || item.status === "已拒绝") ? (
                            <button type="button" onClick={() => acceptItem(item.id)}>接受</button>
                          ) : null}
                          {(item.status === "待处理" || item.status === "制作中") ? (
                            <button type="button" onClick={() => rejectItem(item.id)}>拒绝</button>
                          ) : null}
                          {(item.status === "制作中" || item.status === "已完成") && !editing ? (
                            <button type="button" onClick={() => startEdit(item)}>编辑</button>
                          ) : null}
                          {editing ? (
                            <>
                              <button type="button" onClick={() => saveEdit(item)}>保存</button>
                              <button type="button" onClick={() => setEditingId(0)}>取消</button>
                            </>
                          ) : null}
                          <button type="button" onClick={() => deleteItem(item.id)}>删除</button>
                          <button
                            type="button"
                            className={!openedComments[item.id] && unreadMap[item.id] > 0 ? "unread-comment-btn" : ""}
                            onClick={() => toggleComments(item.id)}
                          >
                            {openedComments[item.id]
                              ? "收起"
                              : unreadMap[item.id] > 0
                                ? `留言（新消息 ${unreadMap[item.id]}）`
                                : "留言"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {openedComments[item.id] ? (
                      <tr key={`${item.id}-comments`}>
                        <td colSpan={11}>
                          <CommentsPanel
                            material={item}
                            comments={commentsMap[item.id] || []}
                            loading={!!commentsLoading[item.id]}
                            draft={commentDrafts[item.id] || ""}
                            onDraftChange={onDraftChange}
                            onSend={sendComment}
                            onRefresh={() => loadComments(item.id)}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager
          pageInfo={materialsPageInfo}
          loading={loading}
          onFirst={() => loadMaterialsPage(1, materialsSearch)}
          onPrev={() => loadMaterialsPage(materialsPageInfo.page - 1, materialsSearch)}
          onNext={() => loadMaterialsPage(materialsPageInfo.page + 1, materialsSearch)}
          onJump={(page) => loadMaterialsPage(page, materialsSearch)}
        />
      </div>
      ) : null}

      {adminTab === "designerAccounts" ? (
        <div className="card ui-card">
          <h3>设计师账号管理</h3>
          <div className="single-add-grid">
            <input
              value={designerSingleForm.account}
              onChange={(e) => setDesignerSingleForm((prev) => ({ ...prev, account: e.target.value }))}
              placeholder="设计师账号"
            />
            <input
              value={designerSingleForm.ownerName}
              onChange={(e) => setDesignerSingleForm((prev) => ({ ...prev, ownerName: e.target.value }))}
              placeholder="对应姓名"
            />
            <button type="button" onClick={addSingleDesigner}>添加设计师</button>
          </div>
          <textarea
            rows={4}
            value={designerBulk}
            onChange={(e) => setDesignerBulk(e.target.value)}
            placeholder="批量格式：账号+姓名（每行一条）"
          />
          <div className="row">
            <button type="button" onClick={addDesignerBulk}>批量添加设计师</button>
          </div>
          <div className="list-toolbar">
            <input
              value={accountsSearchInput}
              onChange={(e) => setAccountsSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") searchAccounts();
              }}
              placeholder="搜索账号、姓名"
            />
            <button type="button" onClick={searchAccounts} disabled={loading}>搜索</button>
            <button
              type="button"
              onClick={() => {
                setAccountsSearchInput("");
                setAccountsSearch("");
                loadAccountsPage(1, "");
              }}
              disabled={loading}
            >
              清空
            </button>
            <button
              type="button"
              onClick={() => loadAccountsPage(accountsPageInfo.page, accountsSearch)}
              disabled={loading}
            >
              刷新
            </button>
          </div>
          <div className="table-wrap small">
            <div className="row">
              <button type="button" onClick={toggleSelectAllAccounts}>全选</button>
              <button type="button" onClick={removeAccountsBatch}>批量删除</button>
              <button type="button" onClick={resetAllAccountQuota}>重置所有人额度</button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>选择</th>
                  <th>账号</th>
                  <th>姓名</th>
                  <th>总额度</th>
                  <th>已用次数</th>
                  <th>剩余额度</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">暂无数据</td>
                  </tr>
                ) : null}
                {accounts.map((item) => (
                  <tr key={item.account}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!selectedAccounts[item.account]}
                        onChange={(e) =>
                          setSelectedAccounts((prev) => ({ ...prev, [item.account]: e.target.checked }))
                        }
                      />
                    </td>
                    <td>{item.account}</td>
                    <td>{item.owner_name || "-"}</td>
                    <td>{item.total_quota}</td>
                    <td>{item.used_count}</td>
                    <td>{Math.max(0, item.total_quota - item.used_count)}</td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        value={quotaAddMap[item.account] || ""}
                        onChange={(e) =>
                          setQuotaAddMap((prev) => ({ ...prev, [item.account]: e.target.value }))
                        }
                        placeholder="次数"
                        className="quota-add-input"
                      />
                      <button type="button" onClick={() => addAccountQuota(item.account)}>增加额度</button>
                      <input
                        type="number"
                        min="0"
                        value={quotaSetMap[item.account] || ""}
                        onChange={(e) =>
                          setQuotaSetMap((prev) => ({ ...prev, [item.account]: e.target.value }))
                        }
                        placeholder="总额度"
                        className="quota-add-input"
                      />
                      <button type="button" onClick={() => setAccountQuota(item.account)}>设置初始额度</button>
                      <button type="button" onClick={() => resetAccountQuota(item.account)}>重置额度</button>
                      <button type="button" onClick={() => removeAccount(item.account)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            pageInfo={accountsPageInfo}
            loading={loading}
            onFirst={() => loadAccountsPage(1, accountsSearch)}
            onPrev={() => loadAccountsPage(accountsPageInfo.page - 1, accountsSearch)}
            onNext={() => loadAccountsPage(accountsPageInfo.page + 1, accountsSearch)}
            onJump={(page) => loadAccountsPage(page, accountsSearch)}
          />
        </div>
      ) : null}

      {adminTab === "staffAccounts" ? (
        <div className="card ui-card">
          <h3>管理员账号管理</h3>
          <div className="single-add-grid">
            <input
              value={staffSingleForm.account}
              onChange={(e) => setStaffSingleForm((prev) => ({ ...prev, account: e.target.value }))}
              placeholder="管理员账号"
            />
            <input
              type="password"
              value={staffSingleForm.password}
              onChange={(e) => setStaffSingleForm((prev) => ({ ...prev, password: e.target.value }))}
              placeholder="管理员密码"
            />
            <button type="button" onClick={addSingleStaff}>添加管理员</button>
          </div>
          <div className="table-wrap small">
            <div className="row">
              <button type="button" onClick={toggleSelectAllStaffs}>全选</button>
              <button type="button" onClick={removeStaffsBatch}>批量删除</button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>选择</th>
                  <th>账号</th>
                  <th>修改密码</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {staffs.map((item) => (
                  <tr key={item.account}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!selectedStaffs[item.account]}
                        onChange={(e) =>
                          setSelectedStaffs((prev) => ({ ...prev, [item.account]: e.target.checked }))
                        }
                      />
                    </td>
                    <td>{item.account}</td>
                    <td>
                      <input
                        type="password"
                        value={staffPasswordMap[item.account] || ""}
                        onChange={(e) =>
                          setStaffPasswordMap((prev) => ({ ...prev, [item.account]: e.target.value }))
                        }
                        placeholder="输入新密码"
                        className="staff-password-input"
                      />
                      <button type="button" onClick={() => updateStaffPassword(item.account)}>保存密码</button>
                    </td>
                    <td>
                      <button type="button" onClick={() => removeStaff(item.account)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {adminTab === "announcement" ? (
        <div className="card ui-card">
          <h3>公告管理</h3>
          <div className="announcement-admin-form">
            <div>
              <label>公告标题</label>
              <input
                value={announcementForm.title}
                maxLength={80}
                onChange={(e) =>
                  setAnnouncementForm((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="例如：系统公告"
              />
            </div>
            <div>
              <label>公告内容</label>
              <textarea
                rows={6}
                value={announcementForm.content}
                maxLength={2000}
                onChange={(e) =>
                  setAnnouncementForm((prev) => ({ ...prev, content: e.target.value }))
                }
                placeholder="请输入要展示给设计师的公告内容"
              />
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={announcementForm.enabled}
                onChange={(e) =>
                  setAnnouncementForm((prev) => ({ ...prev, enabled: e.target.checked }))
                }
              />
              <span>启用公告</span>
            </label>
            <div className="actions">
              <button type="button" onClick={saveAnnouncement}>
                保存公告
              </button>
              <button type="button" onClick={loadAnnouncementConfig}>
                刷新
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <RejectModal
        open={rejectDialog.open}
        value={rejectDialog.reason}
        onChange={(value) => setRejectDialog((prev) => ({ ...prev, reason: value }))}
        onCancel={() => setRejectDialog({ open: false, id: 0, reason: "", saving: false })}
        onConfirm={confirmReject}
        loading={rejectDialog.saving}
      />
      <FullscreenImage src={viewerSrc} onClose={() => setViewerSrc("")} />
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("designer");
  const [headerAnnouncement, setHeaderAnnouncement] = useState({ title: "", content: "", enabled: false });

  useEffect(() => {
    async function loadHeaderAnnouncement() {
      try {
        const res = await fetch(`${API_BASE}/api/announcement`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        setHeaderAnnouncement(data);
      } catch (_error) {
        setHeaderAnnouncement({ title: "", content: "", enabled: false });
      }
    }
    loadHeaderAnnouncement();
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>七筑模型登记平台</h1>
        {tab === "designer" && headerAnnouncement.enabled && headerAnnouncement.content.trim() ? (
          <div className="announcement-card">
            {headerAnnouncement.title ? (
              <span className="announcement-title">{headerAnnouncement.title}</span>
            ) : null}
            <span className="announcement-content">{headerAnnouncement.content}</span>
          </div>
        ) : (
          <span />
        )}
        <div className="tabs">
          <button
            className={tab === "designer" ? "active" : ""}
            type="button"
            onClick={() => setTab("designer")}
          >
            设计师提交          </button>
          <button
            className={tab === "admin" ? "active" : ""}
            type="button"
            onClick={() => setTab("admin")}
          >
            后台管理
          </button>
        </div>
      </header>
      {tab === "designer" ? <DesignerView /> : <AdminView />}
    </div>
  );
}
