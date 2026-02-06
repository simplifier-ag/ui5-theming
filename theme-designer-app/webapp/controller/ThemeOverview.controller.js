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

			// Initialize model for UI5 versions (shared by NewTheme and Import dialogs)
			const oVersionsModel = new JSONModel({
				versions: [],
				selectedVersion: ""
			});
			this.getView().setModel(oVersionsModel, "versions");

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

			// Use explicit port 3001 for API when running on localhost
			// Call backend to load themes - always use relative URL
		// UI5 Middleware Proxy (dev) and Nginx (docker) handle routing to API server
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
			// Fetch available UI5 versions from backend
			const oVersionsModel = this.getView().getModel("versions");

			fetch("/api/available-versions", {
				method: "GET",
				credentials: "include"
			})
				.then(response => response.json())
				.then(data => {
					// Update versions model
					oVersionsModel.setData({
						versions: data.versions,
						selectedVersion: data.defaultVersion
					});
				})
				.catch(error => {
					console.error("Error loading available versions:", error);
					MessageBox.error("Failed to load available UI5 versions: " + error.message);
				});
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
			const oNameInput = this.byId("themeNameInput");
			const oIdInput = this.byId("themeIdInput");
			const oBaseThemeSelect = this.byId("baseThemeSelect");
			const oUi5VersionSelect = this.byId("ui5VersionSelect");
			const oDescriptionInput = this.byId("descriptionInput");

			const sName = oNameInput.getValue().trim();
			const sThemeId = oIdInput.getValue().trim();
			const sBaseTheme = oBaseThemeSelect.getSelectedKey();
			const sUi5Version = oUi5VersionSelect.getSelectedKey();
			const sDescription = oDescriptionInput.getValue().trim();

			// Validate
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
			this.byId("themeNameInput").setValue("");
			this.byId("themeIdInput").setValue("");
			this.byId("baseThemeSelect").setSelectedKey("sap_horizon");
			this.byId("ui5VersionSelect").setSelectedKey("1.96.40");
			this.byId("descriptionInput").setValue("");
		},

		_isValidColor: function (sColor) {
			return /^#[0-9A-F]{6}$/i.test(sColor);
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

			console.log('Selected import file:', file.name);

			// Store selected file
			this._selectedImportFile = file;

			// Update UI
			this.byId( "selectedFileName").setText(file.name);
			this.byId( "importBtn").setEnabled(true);

			// Reset file input for next selection
			this._fileInput.value = '';
		},

		onConfirmImport: function () {
			if (!this._selectedImportFile) {
				MessageBox.error("Please select a theme ZIP file");
				return;
			}

			// Get selected UI5 version
			const oVersionSelect = this.byId( "ui5VersionImportSelect");
			const ui5Version = oVersionSelect.getSelectedKey();

			console.log('Importing theme with UI5 version:', ui5Version);

			// Create FormData to upload the file
			const formData = new FormData();
			formData.append('themeZip', this._selectedImportFile);
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
			// Reset file selection
			this._selectedImportFile = null;
			this.byId( "selectedFileName").setText("No file selected");
			this.byId( "importBtn").setEnabled(false);
		},


	});
});
