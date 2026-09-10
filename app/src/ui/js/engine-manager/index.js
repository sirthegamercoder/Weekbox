import { FS } from "../../../backend/services/filesystem.js";
import { ENGINE_DETAILS } from "../../../backend/config/engines.config.js";
import { engineUpdateService } from "../engines/engineUpdateService.js";
import { engineUpdateToast } from "../engines/engineUpdateToast.js";
import { applyDominantColor } from "../../utils/media/extract-color.util.js";
import { networkStatus } from "../../../backend/core/system/network-status.service.js";
import { sidebar } from "../sidebar.js";
import { getEngineLabel, getEngineLabelKey, i18n, t } from "../i18n/index.js";
import { errorHandler } from "../errors/errorHandler.js";
import {
  getEngineOrder,
  getEngineVersionOrder,
  getPreferredEngineVersion,
  setEngineOrder,
  setEngineVersionOrder,
  setPreferredEngineVersion,
} from "../../../backend/config/engine-preferences.js";

function sortableItems(container, selector) {
  return [...container.children].filter((item) => item.matches(selector));
}

function setupAnimatedSortable(
  container,
  item,
  { selector, axis = "y", onDrop },
) {
  let drag = null;
  let suppressClick = false;
  const flipFrames = new WeakMap();
  item.draggable = false;

  const clearDragStyles = () => {
    item.classList.remove("is-dragging", "is-settling");
    item.style.position = "";
    item.style.left = "";
    item.style.top = "";
    item.style.width = "";
    item.style.height = "";
    item.style.zIndex = "";
    item.style.pointerEvents = "";
    item.style.transform = "";
    item.style.transition = "";
    item.style.translate = "";
  };

  const animateLayout = (previousRects) => {
    const movedItems = sortableItems(container, selector);
    movedItems.forEach((other) => {
      const before = previousRects.get(other);
      if (!before) return;
      const after = other.getBoundingClientRect();
      const distance =
        axis === "x" ? before.left - after.left : before.top - after.top;
      if (!distance) return;
      other.style.setProperty(
        "--engine-sort-shift",
        axis === "x" ? `${distance}px 0` : `0 ${distance}px`,
      );
      void other.offsetWidth;
      const previousFrame = flipFrames.get(other);
      if (previousFrame) cancelAnimationFrame(previousFrame);
      flipFrames.set(
        other,
        requestAnimationFrame(() => {
          flipFrames.delete(other);
          if (drag) other.style.removeProperty("--engine-sort-shift");
        }),
      );
    });
  };

  const movePlaceholder = (clientX, clientY) => {
    if (!drag) return;
    const previousRects = new Map(
      sortableItems(container, selector).map((other) => [
        other,
        other.getBoundingClientRect(),
      ]),
    );
    const pointer = axis === "x" ? clientX : clientY;
    const target = sortableItems(container, selector).find((other) => {
      const rect = other.getBoundingClientRect();
      const midpoint =
        (axis === "x" ? rect.left : rect.top) +
        (axis === "x" ? rect.width : rect.height) / 2;
      return pointer < midpoint;
    });
    if (target) container.insertBefore(drag.placeholder, target);
    else container.appendChild(drag.placeholder);
    animateLayout(previousRects);
  };

  const finish = (cancelled = false) => {
    if (!drag) return;
    const currentDrag = drag;
    drag = null;
    try {
      item.releasePointerCapture(currentDrag.pointerId);
    } catch {}

    if (cancelled) {
      if (currentDrag.originalNextSibling?.parentNode === container) {
        container.insertBefore(
          currentDrag.placeholder,
          currentDrag.originalNextSibling,
        );
      } else {
        container.appendChild(currentDrag.placeholder);
      }
    }

    if (!currentDrag.moved || cancelled) {
      currentDrag.placeholder.replaceWith(item);
      clearDragStyles();
      return;
    }

    const finalRect = currentDrag.placeholder.getBoundingClientRect();
    item.classList.add("is-settling");
    void item.offsetWidth;
    item.style.left = `${finalRect.left}px`;
    item.style.top = `${finalRect.top}px`;
    item.style.transform = "scale(1)";
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 400);
    setTimeout(() => {
      currentDrag.placeholder.replaceWith(item);
      clearDragStyles();
      onDrop?.();
    }, 180);
  };

  item.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
  item.addEventListener("pointerdown", (event) => {
    if (
      (event.pointerType === "mouse" && event.button !== 0) ||
      event.target.closest("button, a, input, select")
    )
      return;
    const rect = item.getBoundingClientRect();
    const placeholder = document.createElement("div");
    placeholder.className = `engine-sort-placeholder ${axis}`;
    placeholder.style.width = `${rect.width}px`;
    placeholder.style.height = `${rect.height}px`;
    placeholder.style.margin = getComputedStyle(item).margin;
    const originalNextSibling = item.nextElementSibling;
    item.after(placeholder);
    document.body.appendChild(item);
    item.classList.add("is-dragging");
    item.style.position = "fixed";
    item.style.left = `${rect.left}px`;
    item.style.top = `${rect.top}px`;
    item.style.width = `${rect.width}px`;
    item.style.height = `${rect.height}px`;
    item.style.zIndex = "1000";
    item.style.pointerEvents = "none";
    item.style.transform = "scale(1.04)";
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      placeholder,
      originalNextSibling,
      moved: false,
    };
    item.setPointerCapture(event.pointerId);
  });
  item.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    drag.moved = true;
    event.preventDefault();
    item.style.left = `${event.clientX - item.offsetWidth / 2}px`;
    item.style.top = `${event.clientY - item.offsetHeight / 2}px`;
    movePlaceholder(event.clientX, event.clientY);
  });
  item.addEventListener("pointerup", (event) => {
    if (drag?.pointerId === event.pointerId) finish();
  });
  item.addEventListener("pointercancel", () => finish(true));
}

export const engineManagerModal = {
  currentIndex: 0,
  resizeObserver: null,
  async init() {
    if (!document.getElementById("engine-manager-modal")) {
      const tpl = document.getElementById("tpl-engine-manager");
      if (!tpl) return;
      document.body.appendChild(tpl.content.cloneNode(true));
      i18n.apply(document.getElementById("engine-manager-modal"));
      document
        .getElementById("engine-manager-close-btn")
        ?.addEventListener("click", () => this.close());
      document
        .getElementById("engine-manager-modal")
        ?.addEventListener("click", (e) => {
          if (e.target.id === "engine-manager-modal") this.close();
        });
      networkStatus.addEventListener("change", () => {
        if (
          document
            .getElementById("engine-manager-modal")
            ?.classList.contains("show")
        ) {
          void this.loadInstalledEngines();
        }
      });
      document.addEventListener("weekbox-process-exit", () => {
        if (
          document
            .getElementById("engine-manager-modal")
            ?.classList.contains("show")
        ) {
          void this.loadInstalledEngines();
        }
      });
    }
  },
  async open() {
    await this.init();
    if (!FS.isInitialized) await FS.init();
    const modal = document.getElementById("engine-manager-modal");
    if (!modal) return;
    sidebar.setActive(sidebar.engineManagerBtn);
    modal.style.display = "flex";
    requestAnimationFrame(() => modal.classList.add("show"));
    await this.loadInstalledEngines();
  },
  close() {
    const modal = document.getElementById("engine-manager-modal");
    if (!modal) return;
    sidebar.syncActive();
    modal.classList.remove("show");
    setTimeout(() => {
      modal.style.display = "none";
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
    }, 300);
  },
  async loadInstalledEngines() {
    const engines = await FS.getInstalledEngines();
    this.render(engines);
  },
  render(engines) {
    const container = document.getElementById("engine-manager-modal-body");
    if (!container) return;
    // Limpieza de renderizado previo
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    container.replaceChildren();
    if (engines.length === 0) {
      const emptyTpl = document.getElementById("tpl-engine-manager-empty");
      if (emptyTpl) {
        container.appendChild(emptyTpl.content.cloneNode(true));
        i18n.apply(container);
      } else {
        const empty = document.createElement("div");
        empty.className = "empty-mods-state";
        empty.style.margin = "auto";
        empty.dataset.i18n = "engineManager.noEngines";
        empty.textContent = t("engineManager.noEngines");
        container.appendChild(empty);
      }
      return;
    }
    // 1. Agrupar los engines por ID
    const groupedEngines = {};
    engines.forEach((engine) => {
      if (!groupedEngines[engine.id]) {
        groupedEngines[engine.id] = [];
      }
      groupedEngines[engine.id].push(engine.version);
    });
    // 2. Keep the carousel and sidebar in the user's preferred order.
    const engineOrder = getEngineOrder(Object.keys(groupedEngines));
    const sortedEngineEntries = Object.entries(groupedEngines).sort((a, b) => {
      return engineOrder.indexOf(a[0]) - engineOrder.indexOf(b[0]);
    });
    // Ajustar el índice por si se borró el último elemento
    if (this.currentIndex >= sortedEngineEntries.length) {
      this.currentIndex = Math.max(0, sortedEngineEntries.length - 1);
    }
    // 3. Crear elementos del layout del carrusel
    const carouselTpl = document.getElementById("tpl-engine-manager-carousel");
    let viewport, track, btnPrev, btnNext, indexContainer;
    if (carouselTpl) {
      const fragment = carouselTpl.content.cloneNode(true);
      viewport = fragment.querySelector(".em-carousel-viewport");
      track = fragment.querySelector(".em-carousel-track");
      btnPrev = fragment.querySelector(".em-nav-btn.left");
      btnNext = fragment.querySelector(".em-nav-btn.right");
      indexContainer = fragment.querySelector(".em-carousel-index");
      container.appendChild(fragment);
    } else {
      viewport = document.createElement("div");
      viewport.className = "em-carousel-viewport";
      track = document.createElement("div");
      track.className = "em-carousel-track";
      btnPrev = document.createElement("button");
      btnPrev.className = "em-nav-btn left";
      btnPrev.type = "button";
      const iconPrev = document.createElement("i");
      iconPrev.className = "fa-solid fa-chevron-left";
      btnPrev.appendChild(iconPrev);
      btnNext = document.createElement("button");
      btnNext.className = "em-nav-btn right";
      btnNext.type = "button";
      const iconNext = document.createElement("i");
      iconNext.className = "fa-solid fa-chevron-right";
      btnNext.appendChild(iconNext);
      indexContainer = document.createElement("div");
      indexContainer.className = "em-carousel-index";
      viewport.append(track, btnPrev, btnNext);
      container.append(viewport, indexContainer);
    }

    const setButtonIcon = (btn, iconClass) => {
      let icon = btn.querySelector("i");
      if (!icon) {
        icon = document.createElement("i");
        btn.appendChild(icon);
      }
      icon.className = iconClass;
    };

    const syncEngineOrder = () => {
      const orderedIds = [...indexContainer.children].map(
        (icon) => icon.dataset.engineId,
      );
      orderedIds.forEach((engineId) => {
        const card = [...track.children].find(
          (candidate) => candidate.dataset.engineId === engineId,
        );
        if (card) track.appendChild(card);
      });
      setEngineOrder(orderedIds);
      sidebar.applyEngineOrder();
      const activeCard = track.querySelector(".engine-column.active");
      this.currentIndex = activeCard
        ? [...track.children].indexOf(activeCard)
        : 0;
      updateCarousel();
    };

    const reorderEngines = (draggedIcon, targetIcon, before) => {
      if (!draggedIcon || !targetIcon || draggedIcon === targetIcon) return;
      if (before) indexContainer.insertBefore(draggedIcon, targetIcon);
      else indexContainer.insertBefore(draggedIcon, targetIcon.nextSibling);
      syncEngineOrder();
    };

    // 4. Generar las tarjetas y los iconos del índice
    sortedEngineEntries.forEach(([engineId, versions]) => {
      const details = ENGINE_DETAILS[engineId] || {
        name: engineId,
        icon: "exe.png",
      };
      const displayName = getEngineLabel(engineId, details.name);
      const card = document.createElement("div");
      card.className = "engine-column";
      card.dataset.engineId = engineId;
      card.addEventListener("click", () => {
        const index = [...track.children].indexOf(card);
        if (this.currentIndex !== index) {
          this.currentIndex = index;
          updateCarousel();
        }
      });

      const headerTpl = document.getElementById("tpl-engine-column-header");
      let header;
      if (headerTpl) {
        header = headerTpl.content.firstElementChild.cloneNode(true);
        const img = header.querySelector(".engine-col-icon");
        img.src = `assets/icons/${details.icon}`;
        img.alt = displayName;
        const nameSpan = header.querySelector(".engine-col-name");
        nameSpan.textContent = displayName;
      } else {
        header = document.createElement("div");
        header.className = "engine-column-header";
        const img = document.createElement("img");
        img.src = `assets/icons/${details.icon}`;
        img.alt = displayName;
        img.className = "engine-col-icon";
        img.crossOrigin = "anonymous";
        img.onerror = () => {
          img.src = "assets/icons/exe.png";
        };
        const nameSpan = document.createElement("span");
        nameSpan.className = "engine-col-name";
        nameSpan.textContent = displayName;
        header.append(img, nameSpan);
      }

      const engineNameElement = header.querySelector(".engine-col-name");
      const engineLabelKey = getEngineLabelKey(engineId);
      if (engineNameElement && engineLabelKey) {
        engineNameElement.dataset.i18n = engineLabelKey;
      }
      card.appendChild(header);

      // Aplicar color extraído con la nueva utilidad y opciones personalizadas
      const imgEl = header.querySelector(".engine-col-icon");
      applyDominantColor(imgEl, card, {
        cssVar: "--engine-color",
        alpha: 0.25,
        fallback: "rgba(255, 255, 255, 0.1)",
      });

      const orderedVersions = getEngineVersionOrder(engineId, versions);
      const versionsList = document.createElement("div");
      versionsList.setAttribute("role", "list");
      versionsList.className = "engine-versions-list";
      const preferredVersion = getPreferredEngineVersion(
        engineId,
        orderedVersions,
      );
      const saveVersionOrder = () =>
        setEngineVersionOrder(
          engineId,
          [...versionsList.children].map((item) => item.dataset.version),
        );
      const setPreferredVersion = (version) => {
        setPreferredEngineVersion(engineId, version);
        versionsList
          .querySelectorAll(".version-item")
          .forEach((versionItem) => {
            const selected = versionItem.dataset.version === version;
            versionItem.classList.toggle("is-preferred", selected);
            const button = versionItem.querySelector(".engine-preferred-btn");
            if (!button) return;
            button.classList.toggle("is-preferred", selected);
            button.title = t(
              selected
                ? "engineManager.preferredVersion"
                : "engineManager.setPreferredVersion",
            );
            button.setAttribute("aria-label", button.title);
          });
      };
      orderedVersions.forEach((version) => {
        const updateDisabled = !networkStatus.online;
        const running = FS.isEngineRunning(engineId, version);
        const hasUpdate =
          (engineId === "codename" && version === "Nightly") ||
          (engineId === "psychonline" && version === "Latest");

        const itemTpl = document.getElementById("tpl-engine-version-item");
        let item;
        if (itemTpl) {
          item = itemTpl.content.firstElementChild.cloneNode(true);
          item.dataset.version = version;
          item.draggable = false;
          item.querySelector(".version-text").textContent = version;
          const updateBtn = item.querySelector(".engine-update-btn");
          if (!hasUpdate && updateBtn) {
            updateBtn.remove();
          } else if (updateBtn) {
            updateBtn.title = updateDisabled
              ? t("engineManager.connectToCheckUpdates")
              : t("settings.checkForUpdates");
            updateBtn.setAttribute(
              "aria-label",
              t("engineManager.checkEngineUpdates", { name: displayName }),
            );
            updateBtn.disabled = updateDisabled;
          }
          const dirBtn = item.querySelector(".engine-dir-btn");
          dirBtn.title = t("engineManager.openDirectory");
          dirBtn.setAttribute("aria-label", t("engineManager.openDirectory"));
          const deleteBtn = item.querySelector(".engine-delete-btn");
          deleteBtn.title = running
            ? t("engineManager.closeBeforeUninstall")
            : t("engineManager.uninstallVersion");
          deleteBtn.setAttribute(
            "aria-label",
            running
              ? t("engineManager.closeBeforeUninstall")
              : t("engineManager.uninstallVersion"),
          );
          deleteBtn.disabled = running;
        } else {
          item = document.createElement("div");
          item.className = "version-item";
          item.dataset.version = version;
          item.draggable = false;
          const versionText = document.createElement("span");
          versionText.className = "version-text";
          versionText.textContent = version;
          const actions = document.createElement("div");
          actions.className = "version-actions";

          if (hasUpdate) {
            const updateBtn = document.createElement("button");
            updateBtn.className = "engine-action-btn engine-update-btn";
            updateBtn.type = "button";
            updateBtn.title = updateDisabled
              ? t("engineManager.connectToCheckUpdates")
              : t("settings.checkForUpdates");
            updateBtn.setAttribute(
              "aria-label",
              t("engineManager.checkEngineUpdates", { name: displayName }),
            );
            updateBtn.disabled = updateDisabled;
            const updateIcon = document.createElement("i");
            updateIcon.className = "fa-solid fa-rotate";
            updateBtn.appendChild(updateIcon);
            actions.appendChild(updateBtn);
          }

          const dirBtn = document.createElement("button");
          dirBtn.className = "engine-action-btn engine-dir-btn";
          dirBtn.type = "button";
          dirBtn.title = t("engineManager.openDirectory");
          dirBtn.setAttribute("aria-label", t("engineManager.openDirectory"));
          const dirIcon = document.createElement("i");
          dirIcon.className = "fa-solid fa-folder-open";
          dirBtn.appendChild(dirIcon);

          const deleteBtn = document.createElement("button");
          deleteBtn.className = "engine-action-btn engine-delete-btn";
          deleteBtn.type = "button";
          deleteBtn.title = running
            ? t("engineManager.closeBeforeUninstall")
            : t("engineManager.uninstallVersion");
          deleteBtn.setAttribute(
            "aria-label",
            running
              ? t("engineManager.closeBeforeUninstall")
              : t("engineManager.uninstallVersion"),
          );
          deleteBtn.disabled = running;
          const deleteIcon = document.createElement("i");
          deleteIcon.className = "fa-solid fa-trash";
          deleteBtn.appendChild(deleteIcon);

          const preferredBtn = document.createElement("button");
          preferredBtn.className = "engine-action-btn engine-preferred-btn";
          preferredBtn.type = "button";
          const preferredIcon = document.createElement("i");
          preferredIcon.className = "fa-solid fa-star";
          preferredIcon.setAttribute("aria-hidden", "true");
          preferredBtn.appendChild(preferredIcon);
          actions.append(dirBtn, deleteBtn, preferredBtn);
          item.append(versionText, actions);
        }

        item.classList.toggle("is-preferred", preferredVersion === version);
        const preferredBtn = item.querySelector(".engine-preferred-btn");
        if (preferredBtn) {
          const selected = preferredVersion === version;
          preferredBtn.classList.toggle("is-preferred", selected);
          preferredBtn.title = t(
            selected
              ? "engineManager.preferredVersion"
              : "engineManager.setPreferredVersion",
          );
          preferredBtn.setAttribute("aria-label", preferredBtn.title);
          preferredBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            setPreferredVersion(version);
          });
        }

        const updateBtn = item.querySelector(".engine-update-btn");
        updateBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          updateBtn.disabled = true;
          setButtonIcon(updateBtn, "fa-solid fa-spinner fa-spin");
          const result = await engineUpdateService.checkEngineUpdate(
            engineId,
            version,
          );
          if (result.status === "current") {
            engineUpdateToast.info(
              engineId,
              displayName,
              t("engineManager.alreadyUpToDate"),
            );
          } else if (result.status === "skipped") {
            engineUpdateToast.info(
              engineId,
              displayName,
              t("engineManager.updateSkipped"),
            );
          } else if (result.status === "pinned") {
            engineUpdateToast.info(
              engineId,
              displayName,
              t("engineManager.versionPinned"),
            );
          } else if (result.status === "unavailable") {
            engineUpdateToast.info(
              engineId,
              displayName,
              t("engineManager.couldNotCheckUpdates"),
            );
          } else if (result.status === "running") {
            engineUpdateToast.info(
              engineId,
              displayName,
              t("engineManager.closeBeforeUpdating"),
            );
          } else if (result.status === "offline") {
            engineUpdateToast.info(
              engineId,
              displayName,
              t("engineManager.connectToCheckUpdates"),
            );
          }
          updateBtn.disabled = false;
          setButtonIcon(updateBtn, "fa-solid fa-rotate");
        });

        item
          .querySelector(".engine-dir-btn")
          ?.addEventListener("click", async (e) => {
            e.stopPropagation();
            const targetPath = `${FS.enginesPath}/${engineId}/${version}`;
            try {
              await Neutralino.os.open(targetPath);
            } catch (e) {}
          });

        const deleteBtn = item.querySelector(".engine-delete-btn");
        deleteBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (FS.isEngineRunning(engineId, version)) return;
          deleteBtn.disabled = true;
          setButtonIcon(deleteBtn, "fa-solid fa-spinner fa-spin");
          const targetPath = `${FS.enginesPath}/${engineId}/${version}`;
          try {
            if (await FS.api.exists(targetPath)) {
              await FS.api.remove(targetPath);
              if (await FS.api.exists(targetPath)) {
                throw new Error(
                  "The engine folder could not be removed. Close the engine and try again.",
                );
              }
            }
            await this.loadInstalledEngines();
          } catch (error) {
            deleteBtn.disabled = false;
            setButtonIcon(deleteBtn, "fa-solid fa-trash");
            errorHandler.show({
              error,
              action: "Uninstall engine",
              item: displayName,
              version,
              storagePath: FS.weekboxPath,
            });
          }
        });
        versionsList.appendChild(item);
        setupAnimatedSortable(versionsList, item, {
          selector: ".version-item",
          onDrop: saveVersionOrder,
        });
      });
      card.appendChild(versionsList);
      track.appendChild(card);
      // -- Icono del  ndice Inferior (Pastilla) --
      const indexIcon = document.createElement("img");
      indexIcon.className = "em-index-icon";
      indexIcon.dataset.engineId = engineId;
      indexIcon.draggable = false;
      indexIcon.src = `assets/icons/${details.icon}`;
      indexIcon.onerror = () => (indexIcon.src = "assets/icons/exe.png");
      indexIcon.title = displayName;
      indexIcon.setAttribute("role", "button");
      indexIcon.setAttribute("tabindex", "0");
      indexIcon.setAttribute("aria-label", displayName);
      indexIcon.addEventListener("click", () => {
        this.currentIndex = [...indexContainer.children].indexOf(indexIcon);
        updateCarousel();
      });
      indexIcon.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.currentIndex = [...indexContainer.children].indexOf(indexIcon);
        updateCarousel();
      });
      indexIcon.addEventListener("keydown", (event) => {
        const direction = ["ArrowLeft", "ArrowUp"].includes(event.key)
          ? -1
          : ["ArrowRight", "ArrowDown"].includes(event.key)
            ? 1
            : 0;
        const target =
          direction < 0
            ? indexIcon.previousElementSibling
            : direction > 0
              ? indexIcon.nextElementSibling
              : null;
        if (!target) return;
        event.preventDefault();
        reorderEngines(indexIcon, target, direction < 0);
        indexIcon.focus();
      });
      indexContainer.appendChild(indexIcon);
      setupAnimatedSortable(indexContainer, indexIcon, {
        selector: ".em-index-icon",
        axis: "x",
        onDrop: syncEngineOrder,
      });
    });
    // 5. L gica de c lculo y actualizaci n del Carrusel
    const updateCarousel = () => {
      const vw = viewport.clientWidth;
      if (vw === 0) return;
      const cardWidth = 300;
      const gap = 30;
      const offset =
        vw / 2 - cardWidth / 2 - this.currentIndex * (cardWidth + gap);
      track.style.transform = `translateX(${offset}px)`;
      Array.from(track.children).forEach((col, idx) => {
        col.classList.toggle("active", idx === this.currentIndex);
      });
      Array.from(indexContainer.children).forEach((icon, idx) => {
        icon.classList.toggle("active", idx === this.currentIndex);
      });
      btnPrev.style.display = this.currentIndex === 0 ? "none" : "flex";
      btnNext.style.display =
        this.currentIndex === sortedEngineEntries.length - 1 ? "none" : "flex";
    };
    btnPrev.addEventListener("click", () => {
      if (this.currentIndex > 0) {
        this.currentIndex--;
        updateCarousel();
      }
    });
    btnNext.addEventListener("click", () => {
      if (this.currentIndex < sortedEngineEntries.length - 1) {
        this.currentIndex++;
        updateCarousel();
      }
    });
    this.resizeObserver = new ResizeObserver(() => updateCarousel());
    this.resizeObserver.observe(viewport);
    requestAnimationFrame(updateCarousel);
  },
};
