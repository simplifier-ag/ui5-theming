sap.ui.define([
	"./BaseController",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"sap/ui/model/json/JSONModel",
	"sap/ui/unified/ColorPickerPopover",
	"sap/ui/unified/ColorPickerDisplayMode",
	"sap/ui/unified/ColorPickerMode"
], function (BaseController, MessageBox, MessageToast, JSONModel, ColorPickerPopover, ColorPickerDisplayMode, ColorPickerMode) {
	"use strict";

	return BaseController.extend("themedesigner.controller.Main", {


		onInit: function () {
			// Initialize empty theme model (will be loaded from DB)
			var oThemeModel = new JSONModel({
				id: null,
				themeId: "",
				name: "",
				baseTheme: "sap_horizon",
				brandColor: "#0070f2",  // SAP Horizon default
				focusColor: "#0032a5",  // SAP Horizon default
				shellColor: "#ffffff",  // SAP Horizon default (white)
				ui5Version: "1.96.40",  // Default UI5 version
				customCss: "/* Add your custom CSS here */\n",
				description: "",
				isModified: false,
				files: [],
				imageSelectOptions: []
			});
			this.getView().setModel(oThemeModel, "themeModel");

			// Initialize debounce timer for preview updates
			this._previewDebounceTimer = null;

			// Initialize ColorPicker references
			this.oBrandColorPicker = null;
			this.oFocusColorPicker = null;
			this.oShellColorPicker = null;

			// Attach to routing to load theme when navigated
			var oRouter = sap.ui.core.UIComponent.getRouterFor(this);
			oRouter.getRoute("themeEditor").attachPatternMatched(this._onThemeMatched, this);

			this.getOwnerComponent().getEventBus().subscribe("app", "navBack", this._onNavBack, this);
		},

		_onThemeMatched: function (oEvent) {
			var iThemeId = oEvent.getParameter("arguments").themeId;
			this._loadTheme(iThemeId);
		},

		_loadTheme: function (iThemeId) {
			this.getView().setBusy(true);

			// Call backend to load theme - always use relative URL
		// UI5 Middleware Proxy (dev) and Nginx (docker) handle routing to API server
		fetch(`/api/themes/${iThemeId}`, {
					credentials: "include"
				})
				.then(function (response) {
					if (!response.ok) {
						throw new Error('Failed to load theme');
					}
					return response.json();
				})
				.then(function (oTheme) {
					var oModel = this.getView().getModel("themeModel");
					oModel.setData({
						id: oTheme.id,
						themeId: oTheme.themeId,
						name: oTheme.name,
						baseTheme: oTheme.baseTheme,
						brandColor: oTheme.brandColor,
						focusColor: oTheme.focusColor,
						shellColor: oTheme.shellColor || "#354a5f",
						ui5Version: oTheme.ui5Version || "1.96.40",
						customCss: oTheme.customCss || "/* Add your custom CSS here */\n",
						backgroundImage: "",
						description: oTheme.description || "",
						isModified: false,
						files: [],
						imageSelectOptions: []
					});

						// Load all files before triggering preview so the background-image
					// Select has its options before selectedKey is applied.
					this._loadFiles(oTheme.id).then(function () {
						oModel.setProperty("/backgroundImage", oTheme.backgroundImage || "");
						this._applyPreview();
					}.bind(this));
				}.bind(this))
				.catch(function (error) {
					console.error('Error loading theme:', error);
					MessageBox.error("Failed to load theme: " + error.message);
					// Navigate back to overview
					var oRouter = sap.ui.core.UIComponent.getRouterFor(this);
					oRouter.navTo("themeOverview");
				}.bind(this))
				.finally(function () {
					this.getView().setBusy(false);
				}.bind(this));
		},

		onThemeIdChange: function () {
			// Mark theme as modified when technical ID changes
			this.getView().getModel("themeModel").setProperty("/isModified", true);
		},

		onThemeNameChange: function () {
			// Mark theme as modified when display name changes
			this.getView().getModel("themeModel").setProperty("/isModified", true);
		},

		onDescriptionChange: function () {
			// Mark theme as modified when description changes
			this.getView().getModel("themeModel").setProperty("/isModified", true);
		},

		onBrandColorChange: function (oEvent) {
			// Apply preview when brand color changes
			var sBrandColor = oEvent.getParameter("value");

			if (sBrandColor && sBrandColor.match(/^#[0-9A-Fa-f]{6}$/)) {
				this.getView().getModel("themeModel").setProperty("/isModified", true);

				// Only apply preview when we have a valid color
				this._applyPreview();
			}
		},

		onFocusColorChange: function (oEvent) {
			// Apply preview when focus color changes
			var sFocusColor = oEvent.getParameter("value");

			// Only apply preview when we have a valid color
			if (sFocusColor && sFocusColor.match(/^#[0-9A-Fa-f]{6}$/)) {
				this.getView().getModel("themeModel").setProperty("/isModified", true);
				this._applyPreview();
			}
		},

		onBrandColorValueHelp: function (oEvent) {
			// Open ColorPicker for Brand Color
			if (!this.oBrandColorPicker) {
				this.oBrandColorPicker = new ColorPickerPopover({
					colorString: this.getView().getModel("themeModel").getProperty("/brandColor"),
					displayMode: ColorPickerDisplayMode.Simplified,
					mode: ColorPickerMode.HSL,
					change: this.onBrandColorPickerChange.bind(this)
				});
			}
			this.oBrandColorPicker.openBy(oEvent.getSource());
		},

		onBrandColorPickerChange: function (oEvent) {
			// Update brand color from ColorPicker
			var sColor = oEvent.getParameter("colorString");

			// Convert to hex if needed (ColorPicker might return rgb format)
			var sHexColor = this._ensureHexColor(sColor);
			this.getView().getModel("themeModel").setProperty("/brandColor", sHexColor);
			this.getView().getModel("themeModel").setProperty("/isModified", true);

			this._applyPreview();
		},

		onFocusColorValueHelp: function (oEvent) {
			// Open ColorPicker for Focus Color
			if (!this.oFocusColorPicker) {
				this.oFocusColorPicker = new ColorPickerPopover({
					colorString: this.getView().getModel("themeModel").getProperty("/focusColor"),
					displayMode: ColorPickerDisplayMode.Simplified,
					mode: ColorPickerMode.HSL,
					change: this.onFocusColorPickerChange.bind(this)
				});
			}
			this.oFocusColorPicker.openBy(oEvent.getSource());
		},

		onFocusColorPickerChange: function (oEvent) {
			// Update focus color from ColorPicker
			var sColor = oEvent.getParameter("colorString");

			// Convert to hex if needed (ColorPicker might return rgb format)
			var sHexColor = this._ensureHexColor(sColor);
			this.getView().getModel("themeModel").setProperty("/focusColor", sHexColor);
			this.getView().getModel("themeModel").setProperty("/isModified", true);

			this._applyPreview();
		},

		onShellColorChange: function (oEvent) {
			// Apply preview when shell color changes
			var sShellColor = oEvent.getParameter("value");

			// Only apply preview when we have a valid color
			if (sShellColor && sShellColor.match(/^#[0-9A-Fa-f]{6}$/)) {
				this.getView().getModel("themeModel").setProperty("/isModified", true);
				this._applyPreview();
			}
		},

		onShellColorValueHelp: function (oEvent) {
			// Open ColorPicker for Shell Color
			if (!this.oShellColorPicker) {
				this.oShellColorPicker = new ColorPickerPopover({
					colorString: this.getView().getModel("themeModel").getProperty("/shellColor"),
					displayMode: ColorPickerDisplayMode.Simplified,
					mode: ColorPickerMode.HSL,
					change: this.onShellColorPickerChange.bind(this)
				});
			}
			this.oShellColorPicker.openBy(oEvent.getSource());
		},

		onShellColorPickerChange: function (oEvent) {
			// Update shell color from ColorPicker
			var sColor = oEvent.getParameter("colorString");

			// Convert to hex if needed (ColorPicker might return rgb format)
			var sHexColor = this._ensureHexColor(sColor);
			this.getView().getModel("themeModel").setProperty("/shellColor", sHexColor);
			this.getView().getModel("themeModel").setProperty("/isModified", true);

			this._applyPreview();
		},

		onCssChange: function () {
			// Apply preview when CSS changes
			this.getView().getModel("themeModel").setProperty("/isModified", true);
			this._applyPreview();
		},

		onCssHelpPress: function () {
			var sVersion = this.getView().getModel("themeModel").getProperty("/ui5Version") || "1.96.40";
			var sUrl = "https://sdk.openui5.org/" + sVersion + "/test-resources/sap/m/demokit/theming/webapp/index.html";
			window.open(sUrl, "_blank");
		},

		onSaveTheme: function () {
			var oModel = this.getView().getModel("themeModel");
			var oThemeData = {
				themeId: oModel.getProperty("/themeId"),
				name: oModel.getProperty("/name"),
				baseTheme: oModel.getProperty("/baseTheme"),
				brandColor: oModel.getProperty("/brandColor"),
				focusColor: oModel.getProperty("/focusColor"),
				shellColor: oModel.getProperty("/shellColor"),
				ui5Version: oModel.getProperty("/ui5Version"),
				customCss: oModel.getProperty("/customCss"),
				backgroundImage: oModel.getProperty("/backgroundImage") || "",
				description: oModel.getProperty("/description")
			};

			var iThemeId = oModel.getProperty("/id");
			this.getView().setBusy(true);

		// Call backend to save theme - always use relative URL
		// UI5 Middleware Proxy (dev) and Nginx (docker) handle routing to API server
		fetch(`/api/themes/${iThemeId}`, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify(oThemeData),
				credentials: "include"
			})
				.then(function (response) {
					if (!response.ok) {
						return response.json().then(function (err) {
							throw new Error(err.error || 'Failed to save theme');
						});
					}
					return response.json();
				})
				.then(function (updatedTheme) {
					oModel.setProperty("/isModified", false);
					MessageBox.success("Theme saved successfully!");
				})
				.catch(function (error) {
					console.error('Error saving theme:', error);
					MessageBox.error("Failed to save theme: " + error.message);
				})
				.finally(function () {
					this.getView().setBusy(false);
				}.bind(this));
		},

		_ensureHexColor: function (color) {
			// If already hex format, return as-is
			if (color && color.match(/^#[0-9A-Fa-f]{6}$/)) {
				return color;
			}

			// Check if it's rgb format: rgb(255,102,0)
			var rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
			if (rgbMatch) {
				var r = parseInt(rgbMatch[1], 10);
				var g = parseInt(rgbMatch[2], 10);
				var b = parseInt(rgbMatch[3], 10);

				// Convert to hex
				return '#' +
					('0' + r.toString(16)).slice(-2) +
					('0' + g.toString(16)).slice(-2) +
					('0' + b.toString(16)).slice(-2);
			}

			// If no # prefix, add it
			if (color && color.match(/^[0-9A-Fa-f]{6}$/)) {
				return '#' + color;
			}

			// Return as-is if we can't parse it
			return color;
		},

		_applyPreview: function () {
			// Debounce: Clear any existing timer
			if (this._previewDebounceTimer) {
				clearTimeout(this._previewDebounceTimer);
			}

			// Set new timer to delay API call
			this._previewDebounceTimer = setTimeout(function() {
				this._doApplyPreview();
			}.bind(this), 300);
		},

		_doApplyPreview: function () {
			var oModel = this.getView().getModel("themeModel");
			var iDbId = oModel.getProperty("/id");

			// Pass files metadata (same shape as compile-theme payload) — the builder handles
			// LESS var generation and url('images/X') rewriting in customCss.
			var aFiles = iDbId ? (oModel.getProperty("/files") || []) : [];

			var oData = {
				baseTheme: oModel.getProperty("/baseTheme"),
				brandColor: oModel.getProperty("/brandColor"),
				focusColor: oModel.getProperty("/focusColor"),
				shellColor: oModel.getProperty("/shellColor"),
				customCss: oModel.getProperty("/customCss") || '',
				backgroundImage: oModel.getProperty("/backgroundImage") || '',
				version: oModel.getProperty("/ui5Version") || '1.96.40',
				files: aFiles
			};

			this.byId("previewContainer").setBusy(true);

			fetch("/api/preview-compile", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(oData)
			})
			.then(function (oRes) { return oRes.json(); })
			.then(function (oResult) {
				var oIframe = document.getElementById('themePreviewIframe');
				if (oIframe && oResult.key) {
					oIframe.onload = function () {
						this.byId("previewContainer").setBusy(false);
					}.bind(this);
					oIframe.src = "/api/preview-page?key=" + oResult.key + "&version=" + oData.version;
				} else {
					this.byId("previewContainer").setBusy(false);
				}
			}.bind(this))
			.catch(function () {
				this.byId("previewContainer").setBusy(false);
			}.bind(this));
		},

		onExport: function () {
			var oThemeModel = this.getView().getModel("themeModel");

			var oThemeData = {
				id: oThemeModel.getProperty("/id"),
				themeId: oThemeModel.getProperty("/themeId"),
				themeName: oThemeModel.getProperty("/name"),
				baseTheme: oThemeModel.getProperty("/baseTheme"),
				brandColor: oThemeModel.getProperty("/brandColor"),
				focusColor: oThemeModel.getProperty("/focusColor"),
				shellColor: oThemeModel.getProperty("/shellColor"),
				ui5Version: oThemeModel.getProperty("/ui5Version"),
				customCss: oThemeModel.getProperty("/customCss"),
				backgroundImage: oThemeModel.getProperty("/backgroundImage") || "",
				description: oThemeModel.getProperty("/description")
			};

			// Validate theme ID
			if (!oThemeData.themeId || oThemeData.themeId.trim() === "") {
				MessageBox.error("Theme ID is missing.");
				return;
			}

			// Show busy indicator
			this.getView().setBusy(true);

			// Call backend to compile theme — always relative URL
			// UI5 Middleware Proxy (dev) and Nginx (docker) handle routing
		fetch("/api/compile-theme", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify(oThemeData),
				credentials: "include"
			})
			.then(function (response) {
				if (!response.ok) {
					throw new Error("Theme compilation failed");
				}
				return response.blob();
			})
			.then(function (blob) {
				// Download the theme as ZIP
				var url = window.URL.createObjectURL(blob);
				var a = document.createElement("a");
				a.href = url;
				a.download = oThemeData.themeId + ".zip";
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				window.URL.revokeObjectURL(url);

				MessageBox.success("Theme exported successfully!");
			}.bind(this))
			.catch(function (error) {
				MessageBox.error("Failed to export theme: " + error.message);
			})
			.finally(function () {
				this.getView().setBusy(false);
			}.bind(this));
		},

		_loadFiles: function (iDbId) {
			return fetch("/api/themes/" + iDbId + "/files", { credentials: "include" })
				.then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
				.then(function (aFiles) {
					var oModel = this.getView().getModel("themeModel");
					oModel.setProperty("/files", aFiles);
					var aImages = aFiles.filter(function (f) { return f.type === 'image'; });
					oModel.setProperty("/imageSelectOptions", [{ key: "", text: "– None –" }].concat(
						aImages.map(function (img) { return { key: img.filename, text: img.filename }; })
					));
				}.bind(this))
				.catch(function (e) { console.error("Failed to load files:", e); });
		},



		onBackgroundImageChange: function () {
			this.getView().getModel("themeModel").setProperty("/isModified", true);
			this._applyPreview();
		},


		onUploadImage: function (oEvent) {
			var oFileUploader = oEvent.getSource();
			var oFile = oFileUploader.oFileUpload.files[0];
			if (!oFile) return;
			var iDbId = this.getView().getModel("themeModel").getProperty("/id");
			var formData = new FormData();
			formData.append("file", oFile);
			this.getView().setBusy(true);
			fetch("/api/themes/" + iDbId + "/files?type=image", {
				method: "POST",
				body: formData,
				credentials: "include"
			})
				.then(function (r) {
					return r.ok ? r.json() : r.json().then(function (e) { return Promise.reject(e); });
				})
				.then(function () {
					oFileUploader.clear();
					this._loadFiles(iDbId);
					MessageToast.show("Image uploaded successfully");
				}.bind(this))
				.catch(function (e) {
					MessageBox.error("Upload failed: " + (e.error || e.message || "Unknown error"));
				})
				.finally(function () {
					this.getView().setBusy(false);
				}.bind(this));
		},

		onDeleteFile: function (oEvent) {
			var oCtx = oEvent.getSource().getBindingContext("themeModel");
			var oFile = oCtx.getObject();
			var iDbId = this.getView().getModel("themeModel").getProperty("/id");
			MessageBox.confirm('Delete "' + oFile.filename + '"?', {
				title: "Delete",
				onClose: function (sAction) {
					if (sAction !== MessageBox.Action.OK) return;
					fetch("/api/themes/" + iDbId + "/files/" + oFile.id, {
						method: "DELETE",
						credentials: "include"
					})
						.then(function (r) {
							if (!r.ok) throw new Error("Delete failed");
							return this._loadFiles(iDbId);
						}.bind(this))
						.catch(function (e) { MessageBox.error(e.message); });
				}.bind(this)
			});
		},

		onCopyLessParam: function (oEvent) {
			var sFilename = oEvent.getSource().getBindingContext("themeModel").getProperty("filename");
			var sParam = '@' + this._filenameToLessParam(sFilename);
			if (navigator.clipboard) {
				navigator.clipboard.writeText(sParam).then(function () {
					MessageToast.show("Copied: " + sParam);
				});
			} else {
				MessageToast.show(sParam);
			}
		},

		// Mirrors filenameToLessParam() in theme-designer-app/server/server.js
		_filenameToLessParam: function (sFilename) {
			var base = sFilename.replace(/\.[^.]+$/, '');
			var words = base.split(/[-_\s]+/).filter(Boolean);
			var pascal = words.map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join('');
			return 'themeImage' + pascal;
		},

		formatLessParam: function (sFilename) {
			return sFilename ? '@' + this._filenameToLessParam(sFilename) : '';
		},

		formatFontFamily: function (sFilename) {
			if (!sFilename) return '';
			var dotIdx = sFilename.lastIndexOf('.');
			var family = dotIdx !== -1 ? sFilename.substring(0, dotIdx) : sFilename;
			return 'font-family: "' + family + '"';
		},

		onUploadFont: function (oEvent) {
			var oFileUploader = oEvent.getSource();
			var oFile = oFileUploader.oFileUpload.files[0];
			if (!oFile) return;
			var iDbId = this.getView().getModel("themeModel").getProperty("/id");
			var formData = new FormData();
			formData.append("file", oFile);
			this.getView().setBusy(true);
			fetch("/api/themes/" + iDbId + "/files?type=font", {
				method: "POST",
				body: formData,
				credentials: "include"
			})
				.then(function (r) {
					return r.ok ? r.json() : r.json().then(function (e) { return Promise.reject(e); });
				})
				.then(function () {
					oFileUploader.clear();
					this._loadFiles(iDbId).then(function () {
						this._applyPreview();
					}.bind(this));
					MessageToast.show("Font uploaded successfully");
				}.bind(this))
				.catch(function (e) {
					MessageBox.error("Upload failed: " + (e.error || e.message || "Unknown error"));
				})
				.finally(function () {
					this.getView().setBusy(false);
				}.bind(this));
		},

		_onNavBack: function () {
			var oModel = this.getView().getModel("themeModel");
			var oRouter = sap.ui.core.UIComponent.getRouterFor(this);
			if (oModel.getProperty("/isModified")) {
				MessageBox.confirm(
					"You have unsaved changes. Are you sure you want to leave?",
					{
						title: "Unsaved Changes",
						onClose: function (sAction) {
							if (sAction === MessageBox.Action.OK) {
								oRouter.navTo("themeOverview");
							}
						}
					}
				);
			} else {
				oRouter.navTo("themeOverview");
			}
		},

		onExit: function () {
			this.getOwnerComponent().getEventBus().unsubscribe("app", "navBack", this._onNavBack, this);
			// Cleanup ColorPicker popovers
			if (this.oBrandColorPicker) {
				this.oBrandColorPicker.destroy();
				this.oBrandColorPicker = null;
			}
			if (this.oFocusColorPicker) {
				this.oFocusColorPicker.destroy();
				this.oFocusColorPicker = null;
			}
			if (this.oShellColorPicker) {
				this.oShellColorPicker.destroy();
				this.oShellColorPicker = null;
			}
		},

		onReset: function () {
			MessageBox.confirm(
				"Are you sure you want to reload the theme from the database? All unsaved changes will be lost.",
				{
					title: "Reset Theme",
					onClose: function (sAction) {
						if (sAction === MessageBox.Action.OK) {
							var oModel = this.getView().getModel("themeModel");
							var iThemeId = oModel.getProperty("/id");
							this._loadTheme(iThemeId);
							MessageBox.information("Theme reloaded from database.");
						}
					}.bind(this)
				}
			);
		}
	});
});
