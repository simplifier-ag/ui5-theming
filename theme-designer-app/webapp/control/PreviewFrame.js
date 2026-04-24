sap.ui.define([
	"sap/ui/core/Control"
], function(Control) {
	"use strict";

	return Control.extend("themedesigner.control.PreviewFrame", {
		metadata: {
			properties: {
				/**
				 * URL of the page to display in the iframe
				 */
				src: {type: "string", defaultValue: "about:blank"}
			},
			aggregations: {
				/**
				 * Layout data for positioning within parent container
				 */
				layoutData: {type: "sap.ui.core.LayoutData", multiple: false}
			}
		},

		renderer: {
			apiVersion: 2,
			render: function(oRm, oControl) {
				oRm.openStart("div", oControl);
				oRm.class("previewFrameWrapper");
				oRm.style("width", "100%");
				oRm.style("height", "100%");
				oRm.openEnd();

				// Render iframe
				oRm.openStart("iframe");
				oRm.attr("id", "themePreviewIframe");
				oRm.attr("src", oControl.getSrc());
				oRm.style("width", "100%");
				oRm.style("height", "100%");
				oRm.style("border", "none");
				oRm.style("display", "block");
				oRm.openEnd();
				oRm.close("iframe");

				oRm.close("div");
			}
		},

		onAfterRendering: function() {
			// After rendering, calculate and set the correct height
			if (Control.prototype.onAfterRendering) {
				Control.prototype.onAfterRendering.apply(this, arguments);
			}

			// Wait a bit for Panel to finish rendering, then calculate height
			setTimeout(function() {
				this._updateHeight();
			}.bind(this), 100);

			// Also update on window resize
			this._resizeHandler = this._updateHeight.bind(this);
			window.addEventListener("resize", this._resizeHandler);
		},

		_updateHeight: function() {
			var oDomRef = this.getDomRef();
			if (!oDomRef) {
				return;
			}

			// Find the Panel's content area
			var oPanelContent = oDomRef.closest('.sapMPanelContent');
			if (oPanelContent) {
				// Get the computed styles to subtract padding
				var oStyles = window.getComputedStyle(oPanelContent);
				var iPaddingTop = parseInt(oStyles.paddingTop, 10) || 0;
				var iPaddingBottom = parseInt(oStyles.paddingBottom, 10) || 0;

				// Calculate available height minus padding
				var iAvailableHeight = oPanelContent.clientHeight - iPaddingTop - iPaddingBottom;
				if (iAvailableHeight > 0) {
					oDomRef.style.height = iAvailableHeight + "px";
				}
			}
		},

		exit: function() {
			// Cleanup resize handler
			if (this._resizeHandler) {
				window.removeEventListener("resize", this._resizeHandler);
				this._resizeHandler = null;
			}

			if (Control.prototype.exit) {
				Control.prototype.exit.apply(this, arguments);
			}
		}
	});
});
