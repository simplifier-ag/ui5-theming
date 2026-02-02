sap.ui.define(["sap/ui/core/UIComponent", "sap/ui/Device", "./model/models"], function (UIComponent, Device, models) {
	"use strict";

	return UIComponent.extend("themedesigner.Component", {
		metadata: {
			manifest: "json",
			interfaces: ["sap.ui.core.IAsyncContentCreation"]
		},
		init: function () {
			// call the base component's init function
			UIComponent.prototype.init.call(this); // create the views based on the url/hash

			// create the device model
			this.setModel(models.createDeviceModel(), "device");

			// Check authentication before initializing router
			this._checkAuthentication().then(function() {
				// create the views based on the url/hash
				this.getRouter().initialize();
			}.bind(this));
		},

		/**
		 * Check if user is authenticated and redirect to login if not
		 * @private
		 * @returns {Promise} Promise that resolves when authentication check is complete
		 */
		_checkAuthentication: function() {
			return new Promise(function(resolve, reject) {
				// Call backend to check authentication status
				// Always use relative URLs - UI5 Middleware Proxy (dev) and Nginx (docker) handle routing
				fetch("/api/user", {
					method: "GET",
					credentials: "include"
				})
				.then(function(response) {
					return response.json();
				})
				.then(function(data) {
					if (data.authenticated) {
						// User is authenticated, create user model
						var oUserModel = new sap.ui.model.json.JSONModel(data.user);
						this.setModel(oUserModel, "user");
						resolve();
					} else {
						// User is not authenticated, redirect to login
						// Relative URL - UI5 Middleware Proxy (dev) and Nginx (docker) handle routing
						window.location.href = "/auth/login";
						reject("Not authenticated");
					}
				}.bind(this))
				.catch(function(error) {
					console.error("Authentication check failed:", error);
					// On error, redirect to login
					window.location.href = "/auth/login";
					reject(error);
				}.bind(this));
			}.bind(this));
		},
		/**
		 * This method can be called to determine whether the sapUiSizeCompact or sapUiSizeCozy
		 * design mode class should be set, which influences the size appearance of some controls.
		 * @public
		 * @returns {string} css class, either 'sapUiSizeCompact' or 'sapUiSizeCozy' - or an empty string if no css class should be set
		 */
		getContentDensityClass: function () {
			if (this.contentDensityClass === undefined) {
				// check whether FLP has already set the content density class; do nothing in this case
				if (document.body.classList.contains("sapUiSizeCozy") || document.body.classList.contains("sapUiSizeCompact")) {
					this.contentDensityClass = "";
				} else if (!Device.support.touch) {
					// apply "compact" mode if touch is not supported
					this.contentDensityClass = "sapUiSizeCompact";
				} else {
					// "cozy" in case of touch support; default for most sap.m controls, but needed for desktop-first controls like sap.ui.table.Table
					this.contentDensityClass = "sapUiSizeCozy";
				}
			}
			return this.contentDensityClass;
		}
	});
});
