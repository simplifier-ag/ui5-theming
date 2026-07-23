sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/m/MessageBox",
	"sap/m/MessageToast"
], function (Controller, JSONModel, MessageBox, MessageToast) {
	"use strict";

	return Controller.extend("themedesigner.controller.ThemeOverview", {

		onInit: function () {
			// Initialize model for theme list
			const oModel = new JSONModel({
				themes: []
			});
			this.getView().setModel(oModel, "themeList");

			// Initialize model for the raw list of available UI5 versions (shared,
			// read-only, by NewTheme and Import dialogs). "selectedVersion" here is
			// the NewTheme dialog's OWN selection — see the comment on "importDialog"
			// below for why each dialog now has its own selectedVersion instead of
			// sharing one: sharing it meant selecting a version in one dialog didn't
			// refresh state (like the base theme list) owned by the other dialog.
			// "selectedVersionBaseThemes" holds the base themes matching versions>/selectedVersion,
			// kept in sync by _updateSelectedVersionBaseThemes (NewTheme dialog only).
			const oVersionsModel = new JSONModel({
				versions: [],
				selectedVersion: "",
				selectedVersionBaseThemes: []
			});
			this.getView().setModel(oVersionsModel, "versions");

			// Initialize model for New Theme dialog form (baseTheme is filled in once
			// available versions/base themes are loaded from the backend)
			this.getView().setModel(new JSONModel({
				name: "",
				themeId: "",
				baseTheme: "",
				description: ""
			}), "newTheme");

			// Initialize model for Import dialog state. selectedVersion is its own,
			// independent from versions>/selectedVersion (used by the New Theme dialog)
			// so picking a version here doesn't need to (and can't) affect the other
			// dialog's state, and vice versa.
			this.getView().setModel(new JSONModel({
				selectedFile: null,
				selectedFileName: "No file selected",
				importReady: false,
				selectedVersion: ""
			}), "importDialog");

			// Attach to routing to clear selection when returning to overview
			const oRouter = sap.ui.core.UIComponent.getRouterFor(this);
			oRouter.getRoute("themeOverview").attachPatternMatched(this._onRouteMatched, this);

			// Load data from backend
			this._loadThemes();
			this._loadAvailableVersions();
		},

		_onRouteMatched: function () {
			// Reload themes to get latest data when returning to overview
			this._loadThemes();
		},

		_loadThemes: function () {
			const oModel = this.getView().getModel("themeList");

			fetch("/api/themes", {
					credentials: "include"
				})
				.then(response => {
					if (!response.ok) {
						throw new Error('Failed to load themes');
					}
					return response.json();
				})
				.then(themes => {
					oModel.setProperty("/themes", themes);
				})
				.catch(error => {
					console.error('Error loading themes:', error);
					MessageBox.error("Failed to load themes: " + error.message);
				});
		},

		onNewTheme: function () {
			// Load and open the new theme dialog
			if (!this._newThemeDialog) {
				this.loadFragment({
					name: "themedesigner.view.NewThemeDialog"
				}).then(function (oDialog) {
					this._newThemeDialog = oDialog;
					this.getView().addDependent(this._newThemeDialog);
					this._newThemeDialog.open();
				}.bind(this));
			} else {
				this._newThemeDialog.open();
			}
		},

		_loadAvailableVersions: function () {
			// Fetch available UI5 versions (with their supported base themes) from backend
			const oVersionsModel = this.getView().getModel("versions");

			fetch("/api/available-versions", {
				method: "GET",
				credentials: "include"
			})
				.then(response => response.json())
				.then(data => {
					// Update versions model (New Theme dialog's own selectedVersion)
					oVersionsModel.setData({
						versions: data.versions,
						selectedVersion: data.defaultVersion,
						selectedVersionBaseThemes: []
					});
					this._updateSelectedVersionBaseThemes();

					// Import dialog has its own, independent selectedVersion
					this.getView().getModel("importDialog").setProperty("/selectedVersion", data.defaultVersion);
				})
				.catch(error => {
					console.error("Error loading available versions:", error);
					MessageBox.error("Failed to load available UI5 versions: " + error.message);
				});
		},

		// Keeps versions>/selectedVersionBaseThemes in sync with versions>/selectedVersion,
		// and resets newTheme>/baseTheme if it's no longer valid for the new selection
		// (e.g. switching from a version that has "Horizon Dark" to one that doesn't).
		_updateSelectedVersionBaseThemes: function () {
			const oVersionsModel = this.getView().getModel("versions");
			const sSelectedVersion = oVersionsModel.getProperty("/selectedVersion");
			const aVersions = oVersionsModel.getProperty("/versions") || [];
			const oVersion = aVersions.find(v => v.key === sSelectedVersion);
			const aBaseThemes = (oVersion && oVersion.baseThemes) || [];

			oVersionsModel.setProperty("/selectedVersionBaseThemes", aBaseThemes);

			const oNewThemeModel = this.getView().getModel("newTheme");
			const sCurrentBaseTheme = oNewThemeModel.getProperty("/baseTheme");
			const bStillValid = aBaseThemes.some(oBaseTheme => oBaseTheme.key === sCurrentBaseTheme);
			if (!bStillValid) {
				oNewThemeModel.setProperty("/baseTheme", aBaseThemes.length > 0 ? aBaseThemes[0].key : "");
			}
		},

		onNewThemeUi5VersionChange: function () {
			this._updateSelectedVersionBaseThemes();
		},

		onThemePress: function (oEvent) {
			const oItem = oEvent.getSource();
			const oContext = oItem.getBindingContext("themeList");
			const oTheme = oContext.getObject();

			// Navigate to theme editor with theme ID
			const oRouter = sap.ui.core.UIComponent.getRouterFor(this);
			oRouter.navTo("themeEditor", {
				themeId: oTheme.id
			});
		},

		onDeleteTheme: function (oEvent) {
			const oItem = oEvent.getSource().getParent().getParent();
			const oContext = oItem.getBindingContext("themeList");
			const oTheme = oContext.getObject();

			MessageBox.confirm(
				`Are you sure you want to delete the theme "${oTheme.name}"?`,
				{
					title: "Delete Theme",
					onClose: function (sAction) {
						if (sAction === MessageBox.Action.OK) {
							this._deleteTheme(oTheme.id);
						}
					}.bind(this)
				}
			);
		},

		_deleteTheme: function (iThemeId) {
			// Call backend to delete theme - always use relative URL
		// UI5 Middleware Proxy (dev) and Nginx (docker) handle routing to API server
		fetch(`/api/themes/${iThemeId}`, {
				method: "DELETE",
				credentials: "include"
			})
				.then(response => {
					if (!response.ok) {
						throw new Error('Failed to delete theme');
					}
					MessageToast.show("Theme deleted successfully");
					this._loadThemes(); // Reload themes
				})
				.catch(error => {
					console.error('Error deleting theme:', error);
					MessageBox.error("Failed to delete theme: " + error.message);
				});
		},

		formatDate: function (sDate) {
			if (!sDate) return "";
			const oDate = new Date(sDate);
			const oOptions = {
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			};
			return oDate.toLocaleDateString('en-US', oOptions);
		},

		// New Theme Dialog Handlers

		onCreateTheme: function () {
			const oNewTheme = this.getView().getModel("newTheme");
			const sName = oNewTheme.getProperty("/name").trim();
			const sThemeId = oNewTheme.getProperty("/themeId").trim();
			const sBaseTheme = oNewTheme.getProperty("/baseTheme");
			const sDescription = oNewTheme.getProperty("/description").trim();
			const sUi5Version = this.getView().getModel("versions").getProperty("/selectedVersion");

			// Validate
			if (!sUi5Version || !sBaseTheme) {
				MessageBox.error("No Theme Builder is currently available. Please try again in a moment.");
				return;
			}
			if (!sName) {
				MessageBox.error("Please enter a display name");
				return;
			}
			if (!sThemeId) {
				MessageBox.error("Please enter a technical ID");
				return;
			}

			// Create theme via API
			// Call backend to create theme - always use relative URL
		// UI5 Middleware Proxy (dev) and Nginx (docker) handle routing to API server
		// Use default colors - user can customize them in the editor
			const oThemeData = {
				themeId: sThemeId,
				name: sName,
				baseTheme: sBaseTheme,
				ui5Version: sUi5Version,
				description: sDescription,
				customCss: ""
				// brandColor, focusColor, shellColor will be set by backend based on baseTheme
			};

			fetch("/api/themes", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify(oThemeData),
				credentials: "include"
			})
				.then(response => {
					if (!response.ok) {
						return response.json().then(err => {
							throw new Error(err.error || 'Failed to create theme');
						});
					}
					return response.json();
				})
				.then(newTheme => {
					MessageToast.show("Theme created successfully");
					this._newThemeDialog.close();
					this._resetNewThemeDialog();
					this._loadThemes(); // Reload themes

					// Navigate to theme editor
					const oRouter = sap.ui.core.UIComponent.getRouterFor(this);
					oRouter.navTo("themeEditor", {
						themeId: newTheme.id
					});
				})
				.catch(error => {
					console.error('Error creating theme:', error);
					MessageBox.error("Failed to create theme: " + error.message);
				});
		},

		onCancelNewTheme: function () {
			this._newThemeDialog.close();
			this._resetNewThemeDialog();
		},

		_resetNewThemeDialog: function () {
			const aBaseThemes = this.getView().getModel("versions").getProperty("/selectedVersionBaseThemes") || [];
			this.getView().getModel("newTheme").setData({
				name: "",
				themeId: "",
				baseTheme: aBaseThemes.length > 0 ? aBaseThemes[0].key : "",
				description: ""
			});
		},

		// Theme Import Handlers

		onImportTheme: function () {
			// Load or create import dialog
			if (!this._importDialog) {
				this.loadFragment({
					name: "themedesigner.view.ImportDialog"
				}).then(function (oDialog) {
					this._importDialog = oDialog;
					this.getView().addDependent(this._importDialog);
					this._importDialog.open();
				}.bind(this));
			} else {
				this._importDialog.open();
			}
		},

		onSelectImportFile: function () {
			// Create a hidden file input element
			if (!this._fileInput) {
				this._fileInput = document.createElement('input');
				this._fileInput.type = 'file';
				this._fileInput.accept = '.zip';
				this._fileInput.style.display = 'none';
				document.body.appendChild(this._fileInput);

				// Attach change handler
				this._fileInput.addEventListener('change', this._onImportFileSelected.bind(this));
			}

			// Trigger file picker
			this._fileInput.click();
		},

		_onImportFileSelected: function (event) {
			const file = event.target.files[0];
			if (!file) return;

			const oImportModel = this.getView().getModel("importDialog");
			oImportModel.setProperty("/selectedFile", file);
			oImportModel.setProperty("/selectedFileName", file.name);
			oImportModel.setProperty("/importReady", true);

			// Reset file input for next selection
			this._fileInput.value = '';
		},

		onConfirmImport: function () {
			const oImportModel = this.getView().getModel("importDialog");
			const file = oImportModel.getProperty("/selectedFile");
			if (!file) {
				MessageBox.error("Please select a theme ZIP file");
				return;
			}

			const ui5Version = oImportModel.getProperty("/selectedVersion");

			// Create FormData to upload the file
			const formData = new FormData();
			formData.append('themeZip', file);
			formData.append('ui5Version', ui5Version);

			// Close dialog and show busy indicator
			this._importDialog.close();
			this.getView().setBusy(true);

			// Call backend to import theme - always use relative URL
			// UI5 Middleware Proxy (dev) and Nginx (docker) handle routing to API server
			fetch("/api/import-theme", {
				method: "POST",
				body: formData,
				credentials: "include"
			})
				.then(response => {
					if (!response.ok) {
						return response.json().then(err => {
							throw new Error(err.error || 'Failed to import theme');
						});
					}
					return response.json();
				})
				.then(newTheme => {
					MessageToast.show(`Theme "${newTheme.name}" imported successfully`);
					this._loadThemes(); // Reload themes

					// Navigate to theme editor
					const oRouter = sap.ui.core.UIComponent.getRouterFor(this);
					oRouter.navTo("themeEditor", {
						themeId: newTheme.id
					});
				})
				.catch(error => {
					console.error('Error importing theme:', error);
					MessageBox.error("Failed to import theme: " + error.message);
				})
				.finally(() => {
					this.getView().setBusy(false);
				});
		},

		onCancelImport: function () {
			this._importDialog.close();
		},

		onImportDialogAfterClose: function () {
			// Reset only the file-selection state — selectedVersion is intentionally
			// left as-is so the chosen UI5 version is remembered for next time
			// (same behavior as the New Theme dialog's version selection).
			const oImportModel = this.getView().getModel("importDialog");
			oImportModel.setProperty("/selectedFile", null);
			oImportModel.setProperty("/selectedFileName", "No file selected");
			oImportModel.setProperty("/importReady", false);
		},


	});
});
