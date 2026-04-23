sap.ui.define([
	"./BaseController",
	"sap/ui/model/json/JSONModel",
	"sap/m/ActionSheet",
	"sap/m/Button"
], function (BaseController, JSONModel, ActionSheet, Button) {
	"use strict";

	return BaseController.extend("themedesigner.controller.App", {
		onInit: function () {
			// apply content density mode to root view
			this.getView().addStyleClass(this.getOwnerComponent().getContentDensityClass());

			// Create app model for navigation state
			const oAppModel = new JSONModel({
				showNavButton: false
			});
			this.getView().setModel(oAppModel, "appModel");

			// Calculate user initials from display name
			const oUserModel = this.getOwnerComponent().getModel("user");
			if (oUserModel) {
				const sDisplayName = oUserModel.getProperty("/displayName");
				const sInitials = this._calculateInitials(sDisplayName);
				oUserModel.setProperty("/initials", sInitials);
			}

			// Listen to route changes to show/hide nav button
			const oRouter = this.getOwnerComponent().getRouter();
			oRouter.attachRouteMatched(this._onRouteMatched, this);
		},

		_onRouteMatched: function (oEvent) {
			const sRouteName = oEvent.getParameter("name");
			const oAppModel = this.getView().getModel("appModel");

			// Show nav button on detail pages (not on overview)
			oAppModel.setProperty("/showNavButton", sRouteName !== "themeOverview");
		},

		onNavBack: function () {
			this.getOwnerComponent().getEventBus().publish("app", "navBack");
		},

		onHomeIconPressed: function () {
			const oRouter = this.getOwnerComponent().getRouter();
			oRouter.navTo("themeOverview");
		},

		_calculateInitials: function (sDisplayName) {
			if (!sDisplayName) return "?";
			const aParts = sDisplayName.trim().split(/\s+/);
			if (aParts.length === 1) {
				return aParts[0].substring(0, 2).toUpperCase();
			}
			return (aParts[0].charAt(0) + aParts[aParts.length - 1].charAt(0)).toUpperCase();
		},

		onAvatarPress: function (oEvent) {
			const oButton = oEvent.getSource();

			// Create ActionSheet if not exists
			if (!this._oActionSheet) {
				this._oActionSheet = new ActionSheet({
					placement: "Bottom",
					buttons: [
						new Button({
							text: "Logout",
							icon: "sap-icon://log",
							press: this.onLogout.bind(this)
						})
					]
				});
				this.getView().addDependent(this._oActionSheet);
			}

			this._oActionSheet.openBy(oButton);
		},

		onLogout: function () {
			// Close ActionSheet if open
			if (this._oActionSheet) {
				this._oActionSheet.close();
			}
			// Call backend logout endpoint
			window.location.href = "/auth/logout";
		}
	});
});